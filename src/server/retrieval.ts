import { query, toPgTextArray, toVector } from "./db.js";
import { cfg } from "./config.js";
import { embedTexts, rerankHits } from "./gemini.js";
import { buildTsQuery, extractKeywords, rrfFuse, type Hit } from "./pure.js";

export type SearchMode = "hybrid" | "vector" | "keyword";

export interface RetrieveOptions {
  userId: string;
  docIds: string[];
  question: string;
  k?: number;
  mode?: SearchMode;
  /** pass a precomputed query embedding to avoid embedding the same question twice (used by the eval script) */
  queryVector?: number[];
  rerank?: boolean;
}

export interface RetrieveResult {
  hits: Hit[];
  terms: string[];
  queryVector: number[];
  timings: { embedMs: number; searchMs: number; rerankMs: number };
}

const CANDIDATES = 20;

function rowToHit(r: any): Hit {
  return {
    docId: r.doc_id,
    docName: r.doc_name,
    chunkIndex: Number(r.chunk_index),
    pageNumber: Number(r.page_number),
    text: r.content,
    score: Number(r.score),
  };
}

const SELECT = `
  select c.doc_id, c.chunk_index, c.page_number, c.content, d.name as doc_name,
         1 - (c.embedding <=> $1::vector) as score
  from chunks c
  join documents d on d.id = c.doc_id`;

async function vectorSearch(userId: string, docIds: string[], vec: string, limit: number): Promise<Hit[]> {
  const rows = await query(
    `${SELECT}
     where c.user_id = $2::text and c.doc_id = any($3::text[])
     order by c.embedding <=> $1::vector
     limit $4::int`,
    [vec, userId, toPgTextArray(docIds), limit]
  );
  return rows.map(rowToHit);
}

async function keywordSearch(userId: string, docIds: string[], vec: string, tsQuery: string, limit: number): Promise<Hit[]> {
  if (!tsQuery) return [];
  const rows = await query(
    `${SELECT}
     where c.user_id = $2::text and c.doc_id = any($3::text[])
       and c.tsv @@ to_tsquery('english', $5::text)
     order by ts_rank_cd(c.tsv, to_tsquery('english', $5::text)) desc
     limit $4::int`,
    [vec, userId, toPgTextArray(docIds), limit, tsQuery]
  );
  return rows.map(rowToHit);
}

/**
 * Hybrid retrieval: semantic (pgvector cosine) + lexical (Postgres full-text) results
 * merged with Reciprocal Rank Fusion, optionally reranked by the LLM.
 *
 * Why hybrid? Embeddings capture meaning but blur exact tokens (names, codes, "week 12",
 * acronyms). Full-text search nails exact terms but misses paraphrases. Fusing both
 * recovers what either would miss on its own.
 */
export async function retrieve(opts: RetrieveOptions): Promise<RetrieveResult> {
  const { userId, docIds, question, k = 6, mode = "hybrid" } = opts;
  const terms = extractKeywords(question);

  const t0 = Date.now();
  const queryVector = opts.queryVector ?? (await embedTexts([question], "query"))[0];
  const embedMs = Date.now() - t0;

  const t1 = Date.now();
  const vec = toVector(queryVector);
  const tsQuery = buildTsQuery(terms);
  const [semantic, lexical] = await Promise.all([
    mode === "keyword" ? Promise.resolve([] as Hit[]) : vectorSearch(userId, docIds, vec, CANDIDATES),
    mode === "vector" ? Promise.resolve([] as Hit[]) : keywordSearch(userId, docIds, vec, tsQuery, CANDIDATES),
  ]);
  const searchMs = Date.now() - t1;

  let fused = mode === "vector" ? semantic : mode === "keyword" ? lexical : rrfFuse([semantic, lexical]);

  let rerankMs = 0;
  const wantRerank = opts.rerank ?? cfg.rerank;
  if (wantRerank && mode === "hybrid") {
    const t2 = Date.now();
    fused = await rerankHits(question, fused.slice(0, 12));
    rerankMs = Date.now() - t2;
  }

  return { hits: fused.slice(0, k), terms, queryVector, timings: { embedMs, searchMs, rerankMs } };
}

/** Whole-document context for study tools, in reading order and evenly sampled to fit the budget. */
export async function loadOrderedChunks(userId: string, docIds: string[]): Promise<Hit[]> {
  const rows = await query(
    `select c.doc_id, c.chunk_index, c.page_number, c.content, d.name as doc_name, 0 as score
     from chunks c join documents d on d.id = c.doc_id
     where c.user_id = $1 and c.doc_id = any($2::text[])
     order by d.created_at, c.doc_id, c.chunk_index`,
    [userId, toPgTextArray(docIds)]
  );
  return rows.map(rowToHit);
}
