import { ApiError, postJson, requestJson, streamNdjson } from "../api";
import type { Chunk, ChatMessage, DocumentMetadata, IndexProgress, Scope, StudyMode } from "../types";
import { splitPage } from "./chunk";
import { extractPages } from "./pdf";

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB, parsing happens in the browser
const MAX_CHUNKS = 600;
const EMBED_BATCH = 50; // keeps every request far below Vercel's 4.5MB body limit

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sends a batch of chunks to the server and waits + retries when Gemini's free-tier rate limit (429) is hit. */
async function storeChunks(
  docId: string,
  chunks: { text: string; pageNumber: number; index: number }[],
  onWait?: (seconds: number) => void
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await postJson(`/api/documents/${docId}/chunks`, { chunks });
      return;
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

/**
 * Reads the PDF in the browser, splits it, then the server embeds the chunks and saves
 * them to the user's account so the document is still there next time they log in.
 */
export async function indexDocument(file: File, onProgress: (p: IndexProgress) => void): Promise<DocumentMetadata> {
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
  const raw: { text: string; pageNumber: number; index: number }[] = [];
  let totalCharacters = 0;
  for (const page of pages) {
    totalCharacters += page.text.length;
    for (const text of splitPage(page.text)) {
      if (text.length >= 20) raw.push({ text, pageNumber: page.pageNumber, index: raw.length });
    }
  }
  if (raw.length === 0) {
    throw new Error("No selectable text found. This looks like a scanned (image-only) PDF. Please upload a text-based PDF.");
  }
  if (raw.length > MAX_CHUNKS) {
    throw new Error(`This PDF is too long (${raw.length} chunks, limit ${MAX_CHUNKS}). Try a shorter document or a few chapters.`);
  }

  // 3. Register the document, then embed + store in small batches (35 to 100%)
  const { id } = await postJson<{ id: string }>("/api/documents", {
    name: fileName,
    size: file.size,
    pageCount: pages.length,
    chunkCount: raw.length,
    totalCharacters,
  });

  try {
    for (let i = 0; i < raw.length; i += EMBED_BATCH) {
      const batch = raw.slice(i, i + EMBED_BATCH);
      const base = 35 + (i / raw.length) * 65;
      report("embedding", base, `Understanding your document (${Math.min(i + EMBED_BATCH, raw.length)}/${raw.length} chunks)…`);
      await storeChunks(id, batch, (s) => report("embedding", base, `Gemini rate limit reached, continuing in ${s}s…`));
    }
    const meta = await postJson<DocumentMetadata>(`/api/documents/${id}/complete`, {});
    report("embedding", 100, "Done");
    return meta;
  } catch (err) {
    // don't leave a half-indexed document behind
    requestJson(`/api/documents/${id}`, { method: "DELETE" }).catch(() => {});
    throw err;
  }
}

export const listDocuments = () => requestJson<DocumentMetadata[]>("/api/documents");
export const deleteDocument = (id: string) => requestJson(`/api/documents/${id}`, { method: "DELETE" });
export const loadHistory = (scope: Scope) => requestJson<ChatMessage[]>(`/api/history?scope=${encodeURIComponent(scope)}`);
export const clearHistory = (scope: Scope) => requestJson(`/api/history?scope=${encodeURIComponent(scope)}`, { method: "DELETE" });

export interface ChatHandlers {
  onMeta: (meta: { sources: Chunk[]; terms: string[] }) => void;
  onDelta: (text: string) => void;
  onDone: (done: { cited: number[] }) => void;
}

/** Streams an answer token by token. Retrieval, history and saving all happen on the server. */
export async function askQuestion(
  params: { scope: Scope; question: string; mode?: StudyMode },
  handlers: ChatHandlers
): Promise<void> {
  await streamNdjson("/api/chat", params, (event) => {
    if (event.type === "meta") handlers.onMeta({ sources: event.sources ?? [], terms: event.terms ?? [] });
    else if (event.type === "delta") handlers.onDelta(event.text ?? "");
    else if (event.type === "done") handlers.onDone({ cited: event.cited ?? [] });
  });
}
