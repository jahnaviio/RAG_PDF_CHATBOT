import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { PDFParse } from "pdf-parse";
import type { Chunk, DocumentIndex, DocumentMetadata, IndexedChunk } from "./types.js";

/**
 * Express app that implements the whole RAG pipeline.
 * It is used both by `server.ts` (local dev / `npm start`) and by the Vercel
 * serverless function in `api/[[...slug]].ts`.
 *
 * IMPORTANT: every response from /api/* is JSON (including errors), so the
 * browser never tries to JSON.parse a plain-text platform error page.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const GENERATION_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS) || 768;

const CHUNK_SIZE = 1000; // characters
const CHUNK_OVERLAP = 200; // characters
const MAX_CHUNKS = 400; // keeps the index (sent back to the browser) small
const EMBED_BATCH_SIZE = 100; // Gemini embedContent batch limit
const TOP_K = 5;
const MAX_FILE_BYTES = 3 * 1024 * 1024; // 3MB (Vercel request bodies are capped at ~4.5MB, base64 adds ~33%)
const MAX_QUESTION_CHARS = 2000;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
// In-memory store. On a long-lived server this is the primary store. On
// serverless platforms (Vercel) separate requests may hit different instances,
// so the browser also keeps each document's index and sends it back with every
// query (see `/api/query`). That makes the app work on cold/new instances too.
const store = new Map<string, DocumentIndex>();

// ---------------------------------------------------------------------------
// Gemini client (lazy so a missing key gives a clean JSON error, not a crash)
// ---------------------------------------------------------------------------
let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new HttpError(
      500,
      "GEMINI_API_KEY is not configured on the server. Add it to your environment variables (Vercel: Project Settings > Environment Variables) and redeploy."
    );
  }
  if (!aiClient) aiClient = new GoogleGenAI({ apiKey });
  return aiClient;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// PDF extraction
// ---------------------------------------------------------------------------
interface PageText {
  pageNumber: number;
  text: string;
}

let workerConfigured = false;
async function configurePdfWorker() {
  if (workerConfigured) return;
  workerConfigured = true;
  // pdf-parse v2 needs its pdf.js worker to be resolvable in serverless
  // bundles. This is best-effort: if the entry point doesn't exist in the
  // installed version we just fall back to the default behaviour.
  try {
    // @ts-ignore - optional sub-path export, may not exist in every version
    const worker: any = await import("pdf-parse/worker");
    const setWorker = (PDFParse as any).setWorker;
    if (typeof setWorker === "function") {
      if (typeof worker.getData === "function") setWorker.call(PDFParse, worker.getData());
      else if (typeof worker.getPath === "function") setWorker.call(PDFParse, worker.getPath());
    }
  } catch {
    /* ignore */
  }
}

async function extractPages(buffer: Buffer): Promise<PageText[]> {
  await configurePdfWorker();
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result: any = await parser.getText();
    const pages: PageText[] = Array.isArray(result?.pages)
      ? result.pages.map((p: any, i: number) => ({
          pageNumber: Number(p.num) || i + 1,
          text: String(p.text ?? ""),
        }))
      : [{ pageNumber: 1, text: String(result?.text ?? "") }];
    return pages;
  } finally {
    try {
      await parser.destroy();
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------
function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split one page into overlapping ~CHUNK_SIZE blocks on sentence/paragraph boundaries. */
function splitPage(text: string): string[] {
  const clean = normalizeText(text);
  if (!clean) return [];

  // Break into sentence-ish segments; hard-split any segment that is still too long.
  const rawSegments = clean.split(/(?<=[.!?])\s+|\n{2,}|\n/).map((s) => s.trim()).filter(Boolean);
  const segments: string[] = [];
  for (const seg of rawSegments) {
    if (seg.length <= CHUNK_SIZE) {
      segments.push(seg);
    } else {
      for (let i = 0; i < seg.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        segments.push(seg.slice(i, i + CHUNK_SIZE));
      }
    }
  }

  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  const flush = () => {
    if (current.length) chunks.push(current.join(" "));
  };

  for (const seg of segments) {
    if (currentLen + seg.length + 1 > CHUNK_SIZE && current.length) {
      flush();
      // carry over trailing segments as overlap
      const overlap: string[] = [];
      let len = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        if (len + current[i].length > CHUNK_OVERLAP) break;
        overlap.unshift(current[i]);
        len += current[i].length + 1;
      }
      current = overlap;
      currentLen = len;
    }
    current.push(seg);
    currentLen += seg.length + 1;
  }
  flush();

  return chunks;
}

// ---------------------------------------------------------------------------
// Embeddings + similarity
// ---------------------------------------------------------------------------
function normalizeVector(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return v.map((x) => x / norm);
}

function roundVector(v: number[]): number[] {
  return v.map((x) => Math.round(x * 1e5) / 1e5);
}

async function embedTexts(texts: string[], kind: "document" | "query"): Promise<number[][]> {
  const ai = getAI();
  const out: number[][] = [];
  // taskType is only supported by the classic embedding models
  const supportsTaskType = /embedding-001|text-embedding/.test(EMBEDDING_MODEL);

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const config: Record<string, unknown> = { outputDimensionality: EMBEDDING_DIMENSIONS };
    if (supportsTaskType) {
      config.taskType = kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
    }
    const res: any = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: batch,
      config,
    });
    const embeddings: any[] = res?.embeddings ?? [];
    if (embeddings.length !== batch.length) {
      throw new HttpError(502, "Embedding service returned an unexpected number of vectors.");
    }
    for (const e of embeddings) out.push(normalizeVector(e.values as number[]));
  }
  return out;
}

function dot(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
function isValidIndex(index: any): index is DocumentIndex {
  return (
    index &&
    typeof index === "object" &&
    index.metadata &&
    typeof index.metadata.id === "string" &&
    Array.isArray(index.chunks) &&
    index.chunks.length > 0 &&
    index.chunks.length <= MAX_CHUNKS * 2 &&
    index.chunks.every(
      (c: any) =>
        c &&
        typeof c.id === "string" &&
        typeof c.text === "string" &&
        typeof c.pageNumber === "number" &&
        Array.isArray(c.embedding) &&
        c.embedding.every((n: any) => typeof n === "number")
    )
  );
}

function newId(): string {
  return `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// App + routes
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY"),
    generationModel: GENERATION_MODEL,
    embeddingModel: EMBEDDING_MODEL,
  });
});

app.get("/api/documents", (_req, res) => {
  res.json(Array.from(store.values()).map((d) => d.metadata));
});

app.delete("/api/documents/:id", (req, res) => {
  store.delete(req.params.id);
  res.json({ success: true });
});

app.post("/api/upload", async (req, res, next) => {
  try {
    const { fileBase64, fileName, fileSize } = req.body ?? {};
    if (typeof fileBase64 !== "string" || !fileBase64) {
      throw new HttpError(400, "No PDF data received.");
    }
    const name = typeof fileName === "string" && fileName ? fileName : "document.pdf";

    const buffer = Buffer.from(fileBase64, "base64");
    if (buffer.length === 0) throw new HttpError(400, "The uploaded file is empty.");
    if (buffer.length > MAX_FILE_BYTES) {
      throw new HttpError(413, "File is too large. Maximum size is 3MB.");
    }
    if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
      throw new HttpError(400, "That file doesn't look like a valid PDF.");
    }

    let pages: PageText[];
    try {
      pages = await extractPages(buffer);
    } catch (err: any) {
      console.error("PDF parse failed:", err);
      throw new HttpError(422, "Could not read this PDF. It may be corrupted or password-protected.");
    }

    // Chunk page by page so every chunk has an exact page number.
    const rawChunks: { text: string; pageNumber: number }[] = [];
    let totalCharacters = 0;
    for (const page of pages) {
      totalCharacters += page.text.length;
      for (const text of splitPage(page.text)) {
        if (text.length >= 20) rawChunks.push({ text, pageNumber: page.pageNumber });
      }
    }

    if (rawChunks.length === 0) {
      throw new HttpError(
        422,
        "No extractable text found. This looks like a scanned/image-only PDF — please upload a text-based PDF."
      );
    }
    if (rawChunks.length > MAX_CHUNKS) {
      throw new HttpError(
        413,
        `This PDF is too long for the live demo (${rawChunks.length} chunks, limit ${MAX_CHUNKS}). Try a shorter document.`
      );
    }

    const vectors = await embedTexts(
      rawChunks.map((c) => c.text),
      "document"
    );

    const id = newId();
    const chunks: IndexedChunk[] = rawChunks.map((c, i) => ({
      id: `${id}_c${i}`,
      text: c.text,
      pageNumber: c.pageNumber,
      embedding: roundVector(vectors[i]),
    }));

    const metadata: DocumentMetadata = {
      id,
      name,
      size: typeof fileSize === "number" ? fileSize : buffer.length,
      uploadTime: new Date().toISOString(),
      pageCount: pages.length,
      chunkCount: chunks.length,
      totalCharacters,
    };

    const index: DocumentIndex = { metadata, chunks };
    store.set(id, index);

    res.json({ metadata, index });
  } catch (err) {
    next(err);
  }
});

app.post("/api/query", async (req, res, next) => {
  try {
    const { documentId, question, index } = req.body ?? {};
    if (typeof question !== "string" || !question.trim()) {
      throw new HttpError(400, "Please enter a question.");
    }
    if (question.length > MAX_QUESTION_CHARS) {
      throw new HttpError(400, `Question is too long (max ${MAX_QUESTION_CHARS} characters).`);
    }

    // Prefer the server copy; fall back to the index the browser sent along
    // (needed on serverless, where memory isn't shared between requests).
    let doc: DocumentIndex | undefined = typeof documentId === "string" ? store.get(documentId) : undefined;
    if (!doc && isValidIndex(index)) {
      doc = index;
      store.set(index.metadata.id, index);
    }
    if (!doc) {
      throw new HttpError(404, "Document not found on the server. Please re-upload the PDF.");
    }

    const [queryVector] = await embedTexts([question.trim()], "query");

    const ranked = doc.chunks
      .map((c) => ({ chunk: c, score: dot(queryVector, c.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);

    const retrievedChunks: Chunk[] = ranked.map(({ chunk, score }) => ({
      id: chunk.id,
      text: chunk.text,
      pageNumber: chunk.pageNumber,
      score,
    }));

    const context = retrievedChunks
      .map((c, i) => `[Source Block #${i + 1} | Page ${c.pageNumber}]\n${c.text}`)
      .join("\n\n---\n\n");

    const systemInstruction =
      "You are a precise document assistant. Answer the user's question using ONLY the context excerpts provided from the PDF. " +
      "Cite every source you used inline in exactly this format: [Source Block #2] (the number of the context block, e.g. [Source Block #1]). Mention page numbers in prose when useful. " +
      "If the answer is not contained in the context, say clearly that the document does not contain that information instead of guessing. " +
      "Use concise Markdown (short paragraphs, bullet points where helpful).";

    const ai = getAI();
    const result: any = await ai.models.generateContent({
      model: GENERATION_MODEL,
      contents: `CONTEXT:\n${context}\n\nQUESTION: ${question.trim()}`,
      config: { systemInstruction, temperature: 0.2 },
    });

    const answer: string = (result?.text ?? "").trim();
    if (!answer) {
      throw new HttpError(502, "The model returned an empty answer. Please try rephrasing your question.");
    }

    res.json({
      answer,
      retrievedChunks,
      question: question.trim(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// Unknown API routes -> JSON 404 (never plain text / HTML)
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found." });
});

// Central JSON error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  let status = 500;
  let message = "Internal server error.";

  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
  } else if (err?.type === "entity.too.large" || err?.status === 413) {
    status = 413;
    message = "File is too large for the live demo. Maximum size is 3MB.";
  } else if (err?.type === "entity.parse.failed") {
    status = 400;
    message = "Malformed request body.";
  } else {
    console.error("Unhandled server error:", err);
    const raw = String(err?.message ?? "");
    if (/API key|API_KEY|PERMISSION_DENIED|UNAUTHENTICATED/i.test(raw)) {
      message = "Gemini rejected the API key. Check GEMINI_API_KEY on the server.";
    } else if (/RESOURCE_EXHAUSTED|quota|429/i.test(raw)) {
      status = 429;
      message = "Gemini rate limit / quota reached. Please wait a moment and try again.";
    } else if (/not found|NOT_FOUND|404/i.test(raw)) {
      message = `A Gemini model was not found (${GENERATION_MODEL} / ${EMBEDDING_MODEL}). Set GEMINI_MODEL / GEMINI_EMBEDDING_MODEL to valid model names.`;
    } else if (raw) {
      message = raw.length > 300 ? raw.slice(0, 300) + "…" : raw;
    }
  }

  res.status(status).json({ error: message });
});

export default app;
