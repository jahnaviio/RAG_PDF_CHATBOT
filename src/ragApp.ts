import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import { GoogleGenAI } from "@google/genai";

/**
 * Stateless Express API. It only does the two things that need the secret
 * Gemini key: creating embeddings and generating the final answer.
 *
 * PDF parsing, chunking, the vector store and similarity search all run in the
 * browser, so requests stay tiny (no Vercel 4.5MB body-limit errors) and it
 * doesn't matter which serverless instance handles a request.
 *
 * Every response from /api/* is JSON, including errors.
 */

const GENERATION_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS) || 768;

const MAX_TEXTS_PER_REQUEST = 100;
const MAX_TEXT_CHARS = 4000;
const MAX_CONTEXT_CHUNKS = 10;
const MAX_QUESTION_CHARS = 2000;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    throw new HttpError(
      500,
      "GEMINI_API_KEY is not configured on the server. Add it in Vercel (Project Settings > Environment Variables) and redeploy."
    );
  }
  if (!aiClient) aiClient = new GoogleGenAI({ apiKey });
  return aiClient;
}

function normalizeVector(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  // normalised + rounded so a dot product equals cosine similarity and payloads stay small
  return v.map((x) => Math.round((x / norm) * 1e5) / 1e5);
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY"),
    generationModel: GENERATION_MODEL,
    embeddingModel: EMBEDDING_MODEL,
  });
});

app.post("/api/embed", async (req, res, next) => {
  try {
    const { texts, kind } = req.body ?? {};
    if (!Array.isArray(texts) || texts.length === 0 || texts.some((t) => typeof t !== "string" || !t.trim())) {
      throw new HttpError(400, "`texts` must be a non-empty array of strings.");
    }
    if (texts.length > MAX_TEXTS_PER_REQUEST) {
      throw new HttpError(400, `Too many texts in one request (max ${MAX_TEXTS_PER_REQUEST}).`);
    }
    const clipped = texts.map((t: string) => t.slice(0, MAX_TEXT_CHARS));

    const config: Record<string, unknown> = { outputDimensionality: EMBEDDING_DIMENSIONS };
    // taskType is only supported by the classic embedding models
    if (/embedding-001|text-embedding/.test(EMBEDDING_MODEL)) {
      config.taskType = kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
    }

    const result: any = await getAI().models.embedContent({
      model: EMBEDDING_MODEL,
      contents: clipped,
      config,
    });
    const embeddings: any[] = result?.embeddings ?? [];
    if (embeddings.length !== clipped.length) {
      throw new HttpError(502, "Embedding service returned an unexpected number of vectors.");
    }
    res.json({ vectors: embeddings.map((e) => normalizeVector(e.values as number[])) });
  } catch (err) {
    next(err);
  }
});

app.post("/api/answer", async (req, res, next) => {
  try {
    const { question, chunks } = req.body ?? {};
    if (typeof question !== "string" || !question.trim()) {
      throw new HttpError(400, "Please enter a question.");
    }
    if (question.length > MAX_QUESTION_CHARS) {
      throw new HttpError(400, `Question is too long (max ${MAX_QUESTION_CHARS} characters).`);
    }
    if (
      !Array.isArray(chunks) ||
      chunks.length === 0 ||
      chunks.length > MAX_CONTEXT_CHUNKS ||
      chunks.some((c: any) => typeof c?.text !== "string" || typeof c?.pageNumber !== "number")
    ) {
      throw new HttpError(400, "No document context was provided.");
    }

    const context = chunks
      .map((c: any, i: number) => `[Source Block #${i + 1} | Page ${c.pageNumber}]\n${String(c.text).slice(0, MAX_TEXT_CHARS)}`)
      .join("\n\n---\n\n");

    const systemInstruction =
      "You are a precise document assistant. Answer the user's question using ONLY the context excerpts provided from the PDF. " +
      "Cite every source you used inline in exactly this format: [Source Block #2] (the number of the context block). " +
      "If the answer is not contained in the context, say clearly that the document does not contain that information instead of guessing. " +
      "Use concise Markdown (short paragraphs, bullet points where helpful).";

    const result: any = await getAI().models.generateContent({
      model: GENERATION_MODEL,
      contents: `CONTEXT:\n${context}\n\nQUESTION: ${question.trim()}`,
      config: { systemInstruction, temperature: 0.2 },
    });

    const answer: string = (result?.text ?? "").trim();
    if (!answer) throw new HttpError(502, "The model returned an empty answer. Please try rephrasing your question.");
    res.json({ answer });
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
  const raw = String(err?.message ?? "");

  if (err instanceof HttpError) {
    status = err.status;
    message = err.message;
  } else if (err?.type === "entity.too.large" || err?.status === 413) {
    status = 413;
    message = "The request was too large.";
  } else if (err?.type === "entity.parse.failed") {
    status = 400;
    message = "Malformed request body.";
  } else {
    console.error("Unhandled server error:", err);
    if (/RESOURCE_EXHAUSTED|quota|rate limit|429/i.test(raw)) {
      status = 429;
      message = "Gemini rate limit reached. Please wait a few seconds and try again.";
    } else if (/API key|API_KEY|PERMISSION_DENIED|UNAUTHENTICATED/i.test(raw)) {
      message = "Gemini rejected the API key. Check GEMINI_API_KEY on the server.";
    } else if (/not found|NOT_FOUND|404/i.test(raw)) {
      message = `A Gemini model was not found (${GENERATION_MODEL} / ${EMBEDDING_MODEL}). Set GEMINI_MODEL / GEMINI_EMBEDDING_MODEL to valid model names.`;
    } else if (raw) {
      message = raw.length > 300 ? raw.slice(0, 300) + "…" : raw;
    }
  }
  res.status(status).json({ error: message });
});

export default app;
