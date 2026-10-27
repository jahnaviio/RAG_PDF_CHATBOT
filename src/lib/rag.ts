import { ApiError, requestJson } from "../api";
import type { Chunk, DocumentIndex, DocumentMetadata, IndexedChunk, IndexProgress } from "../types";
import { splitPage } from "./chunk";
import { extractPages } from "./pdf";

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB, parsing happens in the browser
const MAX_CHUNKS = 600;
const EMBED_BATCH = 50; // keeps every request far below Vercel's 4.5MB body limit
const TOP_K = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Calls /api/embed and waits + retries when Gemini's free-tier rate limit (429) is hit. */
async function embed(
  texts: string[],
  kind: "document" | "query",
  onWait?: (seconds: number) => void
): Promise<number[][]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await requestJson<{ vectors: number[][] }>("/api/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts, kind }),
      });
      return res.vectors;
    } catch (err) {
      if (err instanceof ApiError && err.status === 429 && attempt < 5) {
        const wait = 15 + attempt * 10;
        for (let s = wait; s > 0; s--) {
          onWait?.(s);
          await sleep(1000);
        }
        continue;
      }
      throw err;
    }
  }
}

function dot(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export async function indexDocument(
  file: File,
  onProgress: (p: IndexProgress) => void
): Promise<DocumentIndex> {
  const fileName = file.name;
  const report = (stage: IndexProgress["stage"], percent: number, message: string) =>
    onProgress({ fileName, stage, percent: Math.round(percent), message });

  if (file.size === 0) throw new Error("This file is empty.");
  if (file.size > MAX_FILE_BYTES) throw new Error("This PDF is larger than 25MB. Please use a smaller file.");

  const buffer = await file.arrayBuffer();
  const header = new TextDecoder("latin1").decode(new Uint8Array(buffer.slice(0, 5)));
  if (header !== "%PDF-") throw new Error("That file doesn't look like a valid PDF.");

  // 1. Read the PDF in the browser (0 to 30%)
  report("reading", 2, "Reading your PDF…");
  const pages = await extractPages(buffer, (done, total) =>
    report("reading", 2 + (done / total) * 28, `Reading page ${done} of ${total}…`)
  );

  // 2. Split into overlapping chunks (30 to 35%)
  report("chunking", 32, "Splitting text into searchable chunks…");
  const raw: { text: string; pageNumber: number }[] = [];
  let totalCharacters = 0;
  for (const page of pages) {
    totalCharacters += page.text.length;
    for (const text of splitPage(page.text)) {
      if (text.length >= 20) raw.push({ text, pageNumber: page.pageNumber });
    }
  }
  if (raw.length === 0) {
    throw new Error("No selectable text found. This looks like a scanned (image-only) PDF. Please upload a text-based PDF.");
  }
  if (raw.length > MAX_CHUNKS) {
    throw new Error(`This PDF is too long (${raw.length} chunks, limit ${MAX_CHUNKS}). Try a shorter document or a few chapters.`);
  }

  // 3. Embed in small batches (35 to 100%)
  const vectors: number[][] = [];
  for (let i = 0; i < raw.length; i += EMBED_BATCH) {
    const batch = raw.slice(i, i + EMBED_BATCH);
    const base = 35 + (i / raw.length) * 65;
    report("embedding", base, `Understanding your document (${Math.min(i + EMBED_BATCH, raw.length)}/${raw.length} chunks)…`);
    const v = await embed(
      batch.map((c) => c.text),
      "document",
      (s) => report("embedding", base, `Gemini rate limit reached, continuing in ${s}s…`)
    );
    vectors.push(...v);
  }
  report("embedding", 100, "Done");

  const id = `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const chunks: IndexedChunk[] = raw.map((c, i) => ({
    id: `${id}_c${i}`,
    text: c.text,
    pageNumber: c.pageNumber,
    embedding: vectors[i],
  }));
  const metadata: DocumentMetadata = {
    id,
    name: fileName,
    size: file.size,
    uploadTime: new Date().toISOString(),
    pageCount: pages.length,
    chunkCount: chunks.length,
    totalCharacters,
  };
  return { metadata, chunks };
}

export async function askQuestion(
  question: string,
  index: DocumentIndex
): Promise<{ answer: string; sources: Chunk[] }> {
  const [queryVector] = await embed([question], "query");

  const sources: Chunk[] = index.chunks
    .map((c) => ({ chunk: c, score: dot(queryVector, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K)
    .map(({ chunk, score }) => ({ id: chunk.id, text: chunk.text, pageNumber: chunk.pageNumber, score }));

  const { answer } = await requestJson<{ answer: string }>("/api/answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      chunks: sources.map((s) => ({ text: s.text, pageNumber: s.pageNumber })),
    }),
  });
  return { answer, sources };
}
