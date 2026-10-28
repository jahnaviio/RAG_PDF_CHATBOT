import { GoogleGenAI } from "@google/genai";
import { cfg, hasGeminiKey } from "./config.js";
import { HttpError } from "./errors.js";
import type { Hit } from "./pure.js";

let aiClient: GoogleGenAI | null = null;

export function getAI(): GoogleGenAI {
  if (!hasGeminiKey()) {
    throw new HttpError(
      500,
      "GEMINI_API_KEY is not configured on the server. Add it in Vercel (Project Settings > Environment Variables) and redeploy."
    );
  }
  if (!aiClient) aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
  return aiClient;
}

const MAX_EMBED_CHARS = 4000;

function normalizeVector(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  // normalised + rounded so cosine distance behaves and payloads stay small
  return v.map((x) => Math.round((x / norm) * 1e5) / 1e5);
}

export async function embedTexts(texts: string[], kind: "document" | "query"): Promise<number[][]> {
  const clipped = texts.map((t) => t.slice(0, MAX_EMBED_CHARS));
  const config: Record<string, unknown> = { outputDimensionality: cfg.embeddingDims };
  // taskType is only supported by the classic embedding models
  if (/embedding-001|text-embedding/.test(cfg.embeddingModel)) {
    config.taskType = kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
  }
  const result: any = await getAI().models.embedContent({ model: cfg.embeddingModel, contents: clipped, config });
  const embeddings: any[] = result?.embeddings ?? [];
  if (embeddings.length !== clipped.length) {
    throw new HttpError(502, "Embedding service returned an unexpected number of vectors.");
  }
  return embeddings.map((e) => normalizeVector(e.values as number[]));
}

/**
 * Optional second-stage reranker (ENABLE_RERANK=true). Asks the LLM to order the fused
 * candidates by usefulness. On any failure the original order is kept.
 */
export async function rerankHits(question: string, hits: Hit[]): Promise<Hit[]> {
  if (hits.length <= 1) return hits;
  try {
    const passages = hits.map((h, i) => `[${i}] ${h.text.slice(0, 500).replace(/\s+/g, " ")}`).join("\n");
    const result: any = await getAI().models.generateContent({
      model: cfg.generationModel,
      contents: `Question: ${question}\n\nPassages:\n${passages}\n\nReturn ONLY a JSON array of passage numbers, ordered from most to least useful for answering the question.`,
      config: { temperature: 0, responseMimeType: "application/json" },
    });
    const parsed = JSON.parse(String(result?.text ?? "[]"));
    if (!Array.isArray(parsed)) return hits;
    const order: number[] = [];
    for (const n of parsed) {
      if (Number.isInteger(n) && n >= 0 && n < hits.length && !order.includes(n)) order.push(n);
    }
    for (let i = 0; i < hits.length; i++) if (!order.includes(i)) order.push(i);
    return order.map((i) => hits[i]);
  } catch (err) {
    console.warn("Rerank failed, keeping fused order:", (err as Error)?.message);
    return hits;
  }
}

/** Retries Gemini calls when the free tier rate limit (429) is hit. Used by scripts. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const limited = /RESOURCE_EXHAUSTED|quota|rate limit|429/i.test(String(err?.message ?? ""));
      if (!limited || i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 15000 + i * 10000));
    }
  }
}
