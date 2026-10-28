/**
 * RAG evaluation harness.
 *
 *   npm run eval -- --pdf ./samples/nlp-unit-1.pdf --questions 20
 *
 * 1. Indexes the PDF into your Postgres (as a throwaway "eval-user" document).
 * 2. Builds a test set of N questions (or reuses --dataset). Each question is written by Gemini
 *    from one known chunk, so we know which chunk/page the right answer lives on.
 * 3. For each question, compares retrieval strategies (vector only, keyword only, hybrid, and
 *    optionally hybrid + LLM rerank) with Hit@k, page Hit@k and MRR.
 * 4. Generates an answer with the real prompt and has Gemini grade it against the reference answer.
 * 5. Writes eval/report.md and eval/results.json. Put those numbers in your README / resume.
 *
 * Flags: --pdf <file> (required)  --questions 20  --k 5  --dataset eval/dataset.json  --rerank  --keep
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { splitPage } from "../src/lib/chunk.js";
import { cfg } from "../src/server/config.js";
import { ensureSchema, query } from "../src/server/db.js";
import { embedTexts, getAI, withRetry } from "../src/server/gemini.js";
import { ingestChunks } from "../src/server/ingest.js";
import { chatSystemPrompt, formatContext } from "../src/server/prompts.js";
import { extractCited } from "../src/server/pure.js";
import { retrieve } from "../src/server/retrieval.js";

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, fallback?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};

const pdfPath = opt("pdf");
if (!pdfPath) {
  console.error("Usage: npm run eval -- --pdf ./file.pdf [--questions 20] [--k 5] [--dataset eval/dataset.json] [--rerank] [--keep]");
  process.exit(1);
}
const N = Number(opt("questions", "20"));
const K = Number(opt("k", "5"));
const datasetPath = opt("dataset", "eval/dataset.json")!;
const USER_ID = "eval-user";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const mean = (a: number[]) => (a.length ? a.reduce((s, n) => s + n, 0) / a.length : 0);

// ------------------------------------------------------------ PDF -> chunks (Node)
async function extractPages(data: Uint8Array): Promise<{ pageNumber: number; text: string }[]> {
  const specifier = "pdfjs-dist/legacy/build/pdf.mjs"; // variable on purpose: resolved at runtime only
  let pdfjs: any;
  try {
    pdfjs = await import(specifier);
  } catch {
    pdfjs = await import("pdfjs-dist");
  }
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise;
  const pages: { pageNumber: number; text: string }[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items as any[]) {
      if (typeof item.str !== "string") continue;
      text += item.str + (item.hasEOL ? "\n" : " ");
    }
    pages.push({ pageNumber: i, text });
  }
  return pages;
}

interface EvalItem {
  question: string;
  answer: string;
  chunkIndex?: number;
  page?: number;
}

async function generateDataset(chunks: { text: string; pageNumber: number; index: number }[], n: number): Promise<EvalItem[]> {
  const usable = chunks.filter((c) => c.text.length >= 250);
  const pool = usable.length >= n ? usable : chunks;
  const picked = Array.from({ length: Math.min(n, pool.length) }, (_, j) => pool[Math.floor((j * pool.length) / Math.min(n, pool.length))]);
  const excerpts = picked.map((c, i) => `[${i}] ${c.text.replace(/\s+/g, " ").slice(0, 900)}`).join("\n\n");
  const result: any = await withRetry(() =>
    getAI().models.generateContent({
      model: cfg.generationModel,
      contents:
        `Below are ${picked.length} numbered excerpts from a document. For EACH excerpt write one specific question that can be answered using only that excerpt, ` +
        `plus a concise reference answer. The question must make sense on its own (never say "the excerpt" or "the text").\n` +
        `Return ONLY a JSON array like [{"i":0,"question":"...","answer":"..."}].\n\n${excerpts}`,
      config: { temperature: 0.3, responseMimeType: "application/json" },
    })
  );
  const parsed: any[] = JSON.parse(String(result?.text ?? "[]"));
  return parsed
    .filter((p) => Number.isInteger(p.i) && picked[p.i] && p.question && p.answer)
    .map((p) => ({ question: p.question, answer: p.answer, chunkIndex: picked[p.i].index, page: picked[p.i].pageNumber }));
}

async function judge(question: string, reference: string, candidate: string): Promise<{ score: number; reason: string }> {
  const result: any = await withRetry(() =>
    getAI().models.generateContent({
      model: cfg.generationModel,
      contents:
        `You are grading an answer from a document Q&A system.\nQuestion: ${question}\nReference answer: ${reference}\nCandidate answer: ${candidate}\n\n` +
        `Score 1 if the candidate is correct and consistent with the reference (extra correct detail is fine), 0.5 if only partly correct or incomplete, ` +
        `0 if wrong, contradictory, or it says the information is missing.\nReturn ONLY JSON: {"score": 0 | 0.5 | 1, "reason": "one short sentence"}`,
      config: { temperature: 0, responseMimeType: "application/json" },
    })
  );
  try {
    const p = JSON.parse(String(result?.text ?? "{}"));
    return { score: [0, 0.5, 1].includes(Number(p.score)) ? Number(p.score) : 0, reason: String(p.reason ?? "") };
  } catch {
    return { score: 0, reason: "judge returned invalid JSON" };
  }
}

// --------------------------------------------------------------------- main
await ensureSchema();
const fileName = path.basename(pdfPath);
const buffer = await fs.readFile(pdfPath);
console.log(`Reading ${fileName} …`);
const pages = await extractPages(new Uint8Array(buffer));

const chunks: { text: string; pageNumber: number; index: number }[] = [];
for (const page of pages) for (const text of splitPage(page.text)) if (text.length >= 20) chunks.push({ text, pageNumber: page.pageNumber, index: chunks.length });
console.log(`${pages.length} pages -> ${chunks.length} chunks`);
if (!chunks.length) throw new Error("No extractable text in this PDF.");

const docId = `doc_eval_${Date.now().toString(36)}`;
await query(
  `insert into documents (id, user_id, name, size, page_count, chunk_count, total_characters, status) values ($1,$2,$3,$4,$5,$6,$7,'ready')`,
  [docId, USER_ID, fileName, buffer.length, pages.length, chunks.length, pages.reduce((s, p) => s + p.text.length, 0)]
);

try {
  for (let i = 0; i < chunks.length; i += 50) {
    process.stdout.write(`\rEmbedding ${Math.min(i + 50, chunks.length)}/${chunks.length} chunks …`);
    await withRetry(() => ingestChunks(USER_ID, docId, chunks.slice(i, i + 50)));
  }
  console.log("\nIndexed.");

  let items: EvalItem[];
  try {
    items = JSON.parse(await fs.readFile(datasetPath, "utf8")).items;
    console.log(`Using ${items.length} questions from ${datasetPath}`);
  } catch {
    console.log(`Generating ${N} test questions with Gemini …`);
    items = await generateDataset(chunks, N);
    await fs.mkdir(path.dirname(datasetPath), { recursive: true });
    await fs.writeFile(datasetPath, JSON.stringify({ pdf: fileName, generatedAt: new Date().toISOString(), items }, null, 2));
    console.log(`Saved ${items.length} questions to ${datasetPath} (edit it freely, then re-run).`);
  }

  const strategies = [
    { name: "vector only", mode: "vector" as const, rerank: false },
    { name: "keyword only", mode: "keyword" as const, rerank: false },
    { name: "hybrid (RRF)", mode: "hybrid" as const, rerank: false },
    ...(flag("rerank") ? [{ name: "hybrid + LLM rerank", mode: "hybrid" as const, rerank: true }] : []),
  ];
  const stats: Record<string, { chunkHit: number[]; pageHit: number[]; rr: number[]; ms: number[] }> = {};
  for (const s of strategies) stats[s.name] = { chunkHit: [], pageHit: [], rr: [], ms: [] };
  const answerScores: number[] = [];
  const answerMs: number[] = [];
  const cited: number[] = [];
  const details: any[] = [];

  for (let n = 0; n < items.length; n++) {
    const item = items[n];
    process.stdout.write(`\rEvaluating question ${n + 1}/${items.length} …`);
    const [qv] = await withRetry(() => embedTexts([item.question], "query"));

    let hybridHits: Awaited<ReturnType<typeof retrieve>>["hits"] = [];
    const perStrategy: Record<string, number | null> = {};
    for (const s of strategies) {
      const t0 = Date.now();
      const r = await withRetry(() => retrieve({ userId: USER_ID, docIds: [docId], question: item.question, k: K, mode: s.mode, queryVector: qv, rerank: s.rerank }));
      const st = stats[s.name];
      st.ms.push(Date.now() - t0);
      const chunkRank = item.chunkIndex === undefined ? -1 : r.hits.findIndex((h) => h.chunkIndex === item.chunkIndex);
      const pageRank = item.page === undefined ? -1 : r.hits.findIndex((h) => h.pageNumber === item.page);
      if (item.chunkIndex !== undefined) {
        st.chunkHit.push(chunkRank >= 0 ? 1 : 0);
        st.rr.push(chunkRank >= 0 ? 1 / (chunkRank + 1) : 0);
      }
      if (item.page !== undefined) st.pageHit.push(pageRank >= 0 ? 1 : 0);
      perStrategy[s.name] = chunkRank >= 0 ? chunkRank + 1 : null;
      if (s.name === "hybrid (RRF)") hybridHits = r.hits;
    }

    // answer quality, using the production prompt and hybrid retrieval
    const t1 = Date.now();
    const gen: any = await withRetry(() =>
      getAI().models.generateContent({
        model: cfg.generationModel,
        contents: `PDF CONTEXT:\n${formatContext(hybridHits, false)}\n\nQUESTION: ${item.question}`,
        config: { systemInstruction: chatSystemPrompt([fileName]), temperature: 0.2 },
      })
    );
    answerMs.push(Date.now() - t1);
    const candidate = String(gen?.text ?? "");
    const verdict = await judge(item.question, item.answer, candidate);
    answerScores.push(verdict.score);
    cited.push(extractCited(candidate, hybridHits.length).length > 0 ? 1 : 0);
    details.push({ question: item.question, reference: item.answer, candidate, score: verdict.score, reason: verdict.reason, rankOfCorrectChunk: perStrategy });
    await sleep(800);
  }
  console.log("\n");

  const table = strategies.map((s) => {
    const st = stats[s.name];
    return {
      Strategy: s.name,
      [`Hit@${K} (chunk)`]: round(mean(st.chunkHit)),
      [`Hit@${K} (page)`]: round(mean(st.pageHit)),
      MRR: round(mean(st.rr)),
      "Avg retrieval ms": Math.round(mean(st.ms)),
    };
  });
  console.table(table);
  const answerAccuracy = round(mean(answerScores));
  const citationRate = round(mean(cited));
  console.log(`Answer accuracy (LLM-judged, 0-1): ${answerAccuracy}   Citation rate: ${citationRate}   Avg answer latency: ${Math.round(mean(answerMs))} ms`);

  const header = Object.keys(table[0]);
  const md = [
    `# RAG evaluation report`,
    ``,
    `- PDF: \`${fileName}\` (${pages.length} pages, ${chunks.length} chunks)`,
    `- Questions: ${items.length}   k = ${K}`,
    `- Generation model: \`${cfg.generationModel}\`   Embedding model: \`${cfg.embeddingModel}\` (${cfg.embeddingDims} dims)`,
    `- Date: ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `## Retrieval`,
    ``,
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...table.map((r) => `| ${header.map((h) => (r as any)[h]).join(" | ")} |`),
    ``,
    `## Answers (hybrid retrieval + production prompt)`,
    ``,
    `- Answer accuracy (LLM judge, 1 = correct, 0.5 = partial, 0 = wrong): **${answerAccuracy}**`,
    `- Answers containing a citation: **${citationRate}**`,
    `- Average answer latency: **${Math.round(mean(answerMs))} ms**`,
    ``,
  ].join("\n");
  await fs.writeFile("eval/report.md", md);
  await fs.writeFile("eval/results.json", JSON.stringify({ table, answerAccuracy, citationRate, details }, null, 2));
  console.log("Wrote eval/report.md and eval/results.json");
} finally {
  if (!flag("keep")) await query(`delete from documents where id = $1`, [docId]);
}
