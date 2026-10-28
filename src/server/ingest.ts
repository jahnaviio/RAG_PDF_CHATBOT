import { query, toVector } from "./db.js";
import { embedTexts } from "./gemini.js";

export interface IncomingChunk {
  text: string;
  pageNumber: number;
  index: number;
}

/** Embeds a batch of chunks and stores them (text + vector) for one document. */
export async function ingestChunks(userId: string, docId: string, chunks: IncomingChunk[]): Promise<number> {
  if (!chunks.length) return 0;
  const vectors = await embedTexts(chunks.map((c) => c.text), "document");
  const payload = chunks.map((c, i) => ({
    idx: c.index,
    page: c.pageNumber,
    txt: c.text,
    emb: toVector(vectors[i]),
  }));
  await query(
    `insert into chunks (doc_id, user_id, chunk_index, page_number, content, embedding)
     select $1::text, $2::text, r.idx, r.page, r.txt, r.emb::vector
     from jsonb_to_recordset($3::jsonb) as r(idx int, page int, txt text, emb text)
     on conflict (doc_id, chunk_index) do nothing`,
    [docId, userId, JSON.stringify(payload)]
  );
  return chunks.length;
}
