import "dotenv/config";
import crypto from "node:crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { cfg, databaseUrl, googleClientId, hasAuthSecret, hasGeminiKey } from "./server/config.js";
import { ensureSchema, query } from "./server/db.js";
import { HttpError } from "./server/errors.js";
import { getAI } from "./server/gemini.js";
import {
  clearSessionCookie,
  createSessionToken,
  readSession,
  requireAuth,
  setSessionCookie,
  upsertUser,
  verifyGoogleCredential,
  type SessionUser,
} from "./server/auth.js";
import { ingestChunks, type IncomingChunk } from "./server/ingest.js";
import { logRequest } from "./server/logging.js";
import { chatSystemPrompt, formatContext, generalSystemPrompt, studySystemPrompt } from "./server/prompts.js";
import { detectMode, evenSample, extractCited, isSmallTalk, isStudyMode, percentile, type Hit, type StudyMode } from "./server/pure.js";
import { loadOrderedChunks, retrieve } from "./server/retrieval.js";

/**
 * Express API for the RAG PDF chatbot.
 *
 * - Browser: reads the PDF, splits it into chunks (no big uploads, no Vercel body-limit errors).
 * - Server: signs users in (Google), embeds + stores chunks in Postgres (pgvector),
 *   runs hybrid retrieval, streams Gemini answers, keeps chat history, logs metrics.
 *
 * Every response from /api/* is JSON (or NDJSON for the chat stream), including errors.
 */

const MAX_QUESTION_CHARS = 2000;
const MAX_CHUNKS_PER_DOC = 600;
const MAX_CHUNKS_PER_REQUEST = 50;
const MAX_CHUNK_CHARS = 4000;
const STUDY_CONTEXT_CHARS = 28000;
const HISTORY_TURNS = 10;
const SCOPE_RE = /^(general|all|doc_[a-z0-9_]+)$/;
const DOC_ID_RE = /^doc_[a-z0-9_]+$/;

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const userOf = (res: Response) => res.locals.user as SessionUser;
const withDb: RequestHandler = (_req, _res, next) => {
  ensureSchema().then(() => next(), next);
};

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));

// ------------------------------------------------------------------ public

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    geminiKeyConfigured: hasGeminiKey(),
    databaseConfigured: Boolean(databaseUrl()),
    googleLoginConfigured: Boolean(googleClientId()),
    authSecretConfigured: hasAuthSecret(),
    generationModel: cfg.generationModel,
    embeddingModel: cfg.embeddingModel,
    rerank: cfg.rerank,
  });
});

app.get("/api/config", (_req, res) => {
  res.json({
    googleClientId: googleClientId() || null,
    authReady: Boolean(googleClientId() && hasAuthSecret() && databaseUrl()),
    missing: [
      !googleClientId() && "GOOGLE_CLIENT_ID",
      !hasAuthSecret() && "AUTH_SECRET",
      !databaseUrl() && "DATABASE_URL",
    ].filter(Boolean),
  });
});

app.post(
  "/api/auth/google",
  withDb,
  wrap(async (req, res) => {
    const credential = req.body?.credential;
    if (typeof credential !== "string" || credential.length < 20) throw new HttpError(400, "Missing Google credential.");
    const user = await verifyGoogleCredential(credential);
    await upsertUser(user);
    setSessionCookie(req, res, await createSessionToken(user));
    res.json({ user });
  })
);

app.get(
  "/api/auth/me",
  wrap(async (req, res) => {
    res.json({ user: await readSession(req) });
  })
);

app.post("/api/auth/logout", (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

// -------------------------------------------------------- everything below needs a login

app.use("/api", requireAuth, withDb);

async function resolveScope(userId: string, scope: string): Promise<{ id: string; name: string }[]> {
  if (scope === "general") return [];
  if (scope === "all") {
    const rows = await query<{ id: string; name: string }>(
      `select id, name from documents where user_id = $1 and status = 'ready' order by created_at`,
      [userId]
    );
    if (!rows.length) throw new HttpError(400, "Add a PDF first to chat across your documents.");
    return rows;
  }
  if (!DOC_ID_RE.test(scope)) throw new HttpError(400, "Invalid chat scope.");
  const rows = await query<{ id: string; name: string }>(
    `select id, name from documents where id = $1 and user_id = $2 and status = 'ready'`,
    [scope, userId]
  );
  if (!rows.length) throw new HttpError(404, "That PDF was not found. It may have been deleted.");
  return rows;
}

// ---------------------------------------------------------------- documents

const toMeta = (r: any) => ({
  id: r.id,
  name: r.name,
  size: Number(r.size),
  uploadTime: new Date(r.created_at).toISOString(),
  pageCount: Number(r.page_count),
  chunkCount: Number(r.chunk_count),
  totalCharacters: Number(r.total_characters),
});

app.get(
  "/api/documents",
  wrap(async (_req, res) => {
    const { id: userId } = userOf(res);
    // abandoned uploads (browser closed half-way) are cleaned up lazily
    await query(`delete from documents where user_id = $1 and status = 'processing' and created_at < now() - interval '1 hour'`, [userId]);
    const rows = await query(`select * from documents where user_id = $1 and status = 'ready' order by created_at desc`, [userId]);
    res.json(rows.map(toMeta));
  })
);

app.post(
  "/api/documents",
  wrap(async (req, res) => {
    const { id: userId } = userOf(res);
    const { name, size, pageCount, chunkCount, totalCharacters } = req.body ?? {};
    const int = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
    if (typeof name !== "string" || !name.trim() || name.length > 255) throw new HttpError(400, "Invalid file name.");
    if (!int(size, 0, 60 * 1024 * 1024) || !int(pageCount, 1, 5000) || !int(totalCharacters, 0, 50_000_000)) {
      throw new HttpError(400, "Invalid document details.");
    }
    if (!int(chunkCount, 1, MAX_CHUNKS_PER_DOC)) {
      throw new HttpError(400, `This PDF is too long (limit ${MAX_CHUNKS_PER_DOC} chunks). Try a shorter document or a few chapters.`);
    }

    const [{ docs }] = await query<{ docs: number }>(`select count(*)::int as docs from documents where user_id = $1`, [userId]);
    if (docs >= cfg.maxDocsPerUser) {
      throw new HttpError(403, `You can keep up to ${cfg.maxDocsPerUser} PDFs. Delete one to add another.`);
    }
    const [{ used }] = await query<{ used: number }>(
      `select coalesce(sum(chunk_count), 0)::int as used from documents where user_id = $1 and created_at > now() - interval '24 hours'`,
      [userId]
    );
    if (used + chunkCount > cfg.dailyChunkLimit) {
      throw new HttpError(403, "Daily upload limit reached. Please try again tomorrow.");
    }

    const id = `doc_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
    await query(
      `insert into documents (id, user_id, name, size, page_count, chunk_count, total_characters, status)
       values ($1, $2, $3, $4, $5, $6, $7, 'processing')`,
      [id, userId, name.trim(), size, pageCount, chunkCount, totalCharacters]
    );
    res.json({ id });
  })
);

app.post(
  "/api/documents/:id/chunks",
  wrap(async (req, res) => {
    const { id: userId } = userOf(res);
    const docId = req.params.id;
    if (!DOC_ID_RE.test(docId)) throw new HttpError(400, "Invalid document id.");
    const chunks = req.body?.chunks;
    if (
      !Array.isArray(chunks) ||
      chunks.length === 0 ||
      chunks.length > MAX_CHUNKS_PER_REQUEST ||
      chunks.some(
        (c: any) =>
          typeof c?.text !== "string" ||
          !c.text.trim() ||
          c.text.length > MAX_CHUNK_CHARS ||
          !Number.isInteger(c.pageNumber) ||
          c.pageNumber < 1 ||
          !Number.isInteger(c.index) ||
          c.index < 0 ||
          c.index >= MAX_CHUNKS_PER_DOC
      )
    ) {
      throw new HttpError(400, `Send 1-${MAX_CHUNKS_PER_REQUEST} valid chunks per request.`);
    }
    const owned = await query(`select 1 from documents where id = $1 and user_id = $2 and status = 'processing'`, [docId, userId]);
    if (!owned.length) throw new HttpError(404, "Upload session not found. Please upload the PDF again.");

    const t0 = Date.now();
    const inserted = await ingestChunks(userId, docId, chunks as IncomingChunk[]);
    void logRequest({ userId, kind: "upload", scope: docId, status: 200, latencyMs: Date.now() - t0 });
    res.json({ inserted });
  })
);

app.post(
  "/api/documents/:id/complete",
  wrap(async (req, res) => {
    const { id: userId } = userOf(res);
    const docId = req.params.id;
    if (!DOC_ID_RE.test(docId)) throw new HttpError(400, "Invalid document id.");
    const [{ n }] = await query<{ n: number }>(`select count(*)::int as n from chunks where doc_id = $1 and user_id = $2`, [docId, userId]);
    if (n === 0) throw new HttpError(422, "No text could be stored for this PDF.");
    const rows = await query(
      `update documents set status = 'ready', chunk_count = $3 where id = $1 and user_id = $2 returning *`,
      [docId, userId, n]
    );
    if (!rows.length) throw new HttpError(404, "Document not found.");
    res.json(toMeta(rows[0]));
  })
);

app.delete(
  "/api/documents/:id",
  wrap(async (req, res) => {
    const { id: userId } = userOf(res);
    const docId = req.params.id;
    if (!DOC_ID_RE.test(docId)) throw new HttpError(400, "Invalid document id.");
    await query(`delete from documents where id = $1 and user_id = $2`, [docId, userId]); // chunks cascade
    await query(`delete from messages where user_id = $1 and scope = $2`, [userId, docId]);
    res.json({ success: true });
  })
);

// ------------------------------------------------------------------ history

app.get(
  "/api/history",
  wrap(async (req, res) => {
    const { id: userId } = userOf(res);
    const scope = String(req.query.scope ?? "");
    if (!SCOPE_RE.test(scope)) throw new HttpError(400, "Invalid chat scope.");
    const rows = await query(
      `select id, role, content, sources, cited, terms from (
         select seq, id, role, content, sources, cited, terms from messages
         where user_id = $1 and scope = $2 order by seq desc limit 200
       ) t order by seq`,
      [userId, scope]
    );
    res.json(
      rows.map((r: any) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        sources: r.sources ?? undefined,
        cited: r.cited ?? undefined,
        terms: r.terms ?? undefined,
      }))
    );
  })
);

app.delete(
  "/api/history",
  wrap(async (req, res) => {
    const { id: userId } = userOf(res);
    const scope = String(req.query.scope ?? "");
    if (!SCOPE_RE.test(scope)) throw new HttpError(400, "Invalid chat scope.");
    await query(`delete from messages where user_id = $1 and scope = $2`, [userId, scope]);
    res.json({ success: true });
  })
);

// --------------------------------------------------------------------- chat

async function enforceDailyLimit(userId: string) {
  const [{ n }] = await query<{ n: number }>(
    `select count(*)::int as n from messages where user_id = $1 and role = 'user' and created_at > now() - interval '24 hours'`,
    [userId]
  );
  if (n >= cfg.dailyMessageLimit) {
    throw new HttpError(403, `Daily limit of ${cfg.dailyMessageLimit} messages reached. Please come back tomorrow.`);
  }
}

app.post(
  "/api/chat",
  wrap(async (req, res) => {
    const startedAt = Date.now();
    const user = userOf(res);
    const { scope, question, mode: requestedMode } = req.body ?? {};

    if (typeof scope !== "string" || !SCOPE_RE.test(scope)) throw new HttpError(400, "Invalid chat scope.");
    if (typeof question !== "string" || !question.trim()) throw new HttpError(400, "Please enter a question.");
    if (question.length > MAX_QUESTION_CHARS) throw new HttpError(400, `Question is too long (max ${MAX_QUESTION_CHARS} characters).`);
    const q = question.trim();

    let mode: StudyMode = "chat";
    let retrievalMs = 0;
    let streamStarted = false;
    const fail = async (err: unknown, status: number) => {
      await logRequest({ userId: user.id, kind: "chat", scope, mode, status, latencyMs: Date.now() - startedAt, retrievalMs, error: String((err as Error)?.message ?? err) });
    };

    try {
      await enforceDailyLimit(user.id);
      const docs = await resolveScope(user.id, scope);

      mode = docs.length ? (isStudyMode(requestedMode) ? requestedMode : detectMode(q)) : "chat";

      // ---- retrieval -------------------------------------------------------
      let hits: Hit[] = [];
      let terms: string[] = [];
      let contextText = "";
      const multi = docs.length > 1;
      if (docs.length) {
        const t0 = Date.now();
        if (mode === "chat") {
          if (!isSmallTalk(q)) {
            const r = await retrieve({ userId: user.id, docIds: docs.map((d) => d.id), question: q, k: multi ? 8 : 6 });
            hits = r.hits;
            terms = r.terms;
            contextText = formatContext(hits, multi);
          }
        } else {
          const all = await loadOrderedChunks(user.id, docs.map((d) => d.id));
          const sample = evenSample(all, STUDY_CONTEXT_CHARS, (h) => h.text.length);
          contextText = sample.map((h) => `[Page ${h.pageNumber}${multi ? ` | ${h.docName}` : ""}]\n${h.text}`).join("\n\n");
        }
        retrievalMs = Date.now() - t0;
      }

      // ---- prompt ----------------------------------------------------------
      const system =
        mode !== "chat" ? studySystemPrompt(mode) : docs.length ? chatSystemPrompt(docs.map((d) => d.name)) : generalSystemPrompt();

      let finalTurn = q;
      if (mode === "chat" && docs.length) {
        finalTurn = `PDF CONTEXT:\n${contextText || "(none: no excerpts were retrieved for this message)"}\n\nQUESTION: ${q}`;
      } else if (mode !== "chat") {
        finalTurn = `PDF CONTENT:\n${contextText}\n\nUSER REQUEST: ${q}`;
      }

      const historyRows = await query<{ role: string; content: string }>(
        `select role, content from messages where user_id = $1 and scope = $2 order by seq desc limit ${HISTORY_TURNS}`,
        [user.id, scope]
      );
      const contents = [
        ...historyRows.reverse().map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content.slice(0, 2500) }],
        })),
        { role: "user", parts: [{ text: finalTurn }] },
      ];

      // ---- generation (errors here still produce a normal JSON error response) --
      const stream: any = await getAI().models.generateContentStream({
        model: cfg.generationModel,
        contents,
        config: { systemInstruction: system, temperature: mode === "chat" ? 0.4 : 0.3 },
      });

      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      streamStarted = true;

      let clientClosed = false;
      res.on("close", () => {
        if (!res.writableEnded) clientClosed = true;
      });
      const send = (event: Record<string, unknown>) => res.write(JSON.stringify(event) + "\n");

      const sources = hits.map((h) => ({
        id: `${h.docId}_c${h.chunkIndex}`,
        text: h.text,
        pageNumber: h.pageNumber,
        score: Math.round(h.score * 100) / 100,
        docName: multi ? h.docName : undefined,
      }));
      send({ type: "meta", sources, terms, mode });

      let answer = "";
      let ttftMs: number | undefined;
      let promptTokens: number | undefined;
      let outputTokens: number | undefined;
      try {
        for await (const chunk of stream) {
          if (clientClosed) break;
          const text: string = chunk?.text ?? "";
          if (text) {
            if (ttftMs === undefined) ttftMs = Date.now() - startedAt;
            answer += text;
            send({ type: "delta", text });
          }
          if (chunk?.usageMetadata) {
            promptTokens = chunk.usageMetadata.promptTokenCount ?? promptTokens;
            outputTokens = chunk.usageMetadata.candidatesTokenCount ?? outputTokens;
          }
        }
      } catch (err) {
        const message = friendlyError(err).message;
        if (!clientClosed) send({ type: "error", message });
        await fail(err, 502);
        return res.end();
      }

      if (clientClosed) {
        await fail("client disconnected", 499);
        return;
      }
      if (!answer.trim()) {
        send({ type: "error", message: "The model returned an empty answer. Please try rephrasing your question." });
        await fail("empty answer", 502);
        return res.end();
      }

      const cited = mode === "chat" ? extractCited(answer, sources.length) : [];
      await query(
        `insert into messages (id, user_id, scope, role, content, sources, cited, terms) values
           ($1, $2, $3, 'user', $4, null, null, null),
           ($5, $2, $3, 'assistant', $6, $7::jsonb, $8::jsonb, $9::jsonb)`,
        [
          crypto.randomUUID(),
          user.id,
          scope,
          q,
          crypto.randomUUID(),
          answer,
          sources.length ? JSON.stringify(sources) : null,
          sources.length ? JSON.stringify(cited) : null,
          terms.length ? JSON.stringify(terms) : null,
        ]
      );

      send({ type: "done", cited, usage: { promptTokens, outputTokens } });
      await logRequest({
        userId: user.id,
        kind: "chat",
        scope,
        mode,
        status: 200,
        latencyMs: Date.now() - startedAt,
        retrievalMs,
        ttftMs,
        promptTokens,
        outputTokens,
      });
      res.end();
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      await fail(err, status);
      if (streamStarted) {
        // headers already sent: report through the stream instead
        res.write(JSON.stringify({ type: "error", message: friendlyError(err).message }) + "\n");
        return res.end();
      }
      throw err;
    }
  })
);

// ------------------------------------------------------------------ metrics

app.get(
  "/api/metrics",
  wrap(async (_req, res) => {
    const user = userOf(res);
    if (!cfg.adminEmails.includes(user.email.toLowerCase())) throw new HttpError(403, "Metrics are only available to admins (set ADMIN_EMAILS).");
    const days = 7;
    const rows = await query<any>(
      `select status, latency_ms, retrieval_ms, ttft_ms, prompt_tokens, output_tokens
       from request_logs where kind = 'chat' and created_at > now() - interval '${days} days'`
    );
    const ok = rows.filter((r) => r.status === 200);
    const nums = (key: string) =>
      ok
        .map((r) => r[key])
        .filter((v) => v !== null && v !== undefined)
        .map(Number)
        .filter((n) => Number.isFinite(n));
    const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, n) => s + n, 0) / a.length) : 0);
    const [{ users }] = await query<{ users: number }>(`select count(*)::int as users from users`);
    const [{ docs }] = await query<{ docs: number }>(`select count(*)::int as docs from documents where status = 'ready'`);
    res.json({
      windowDays: days,
      requests: rows.length,
      errorRate: rows.length ? Math.round(((rows.length - ok.length) / rows.length) * 1000) / 10 : 0,
      latencyMs: { p50: percentile(nums("latency_ms"), 50), p95: percentile(nums("latency_ms"), 95) },
      timeToFirstTokenMs: { p50: percentile(nums("ttft_ms"), 50), p95: percentile(nums("ttft_ms"), 95) },
      retrievalMs: { avg: avg(nums("retrieval_ms")) },
      tokens: { promptTotal: nums("prompt_tokens").reduce((s, n) => s + n, 0), outputTotal: nums("output_tokens").reduce((s, n) => s + n, 0) },
      totals: { users, documents: docs },
    });
  })
);

// ------------------------------------------------------------------- errors

// Unknown API routes -> JSON 404 (never plain text / HTML)
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found." });
});

function friendlyError(err: any): { status: number; message: string } {
  const raw = String(err?.message ?? "");
  if (err instanceof HttpError) return { status: err.status, message: err.message };
  if (err?.type === "entity.too.large" || err?.status === 413) return { status: 413, message: "The request was too large." };
  if (err?.type === "entity.parse.failed") return { status: 400, message: "Malformed request body." };
  if (/RESOURCE_EXHAUSTED|quota|rate limit|429/i.test(raw)) {
    return { status: 429, message: "Gemini rate limit reached. Please wait a few seconds and try again." };
  }
  if (/API key|API_KEY|PERMISSION_DENIED|UNAUTHENTICATED/i.test(raw)) {
    return { status: 500, message: "Gemini rejected the API key. Check GEMINI_API_KEY on the server." };
  }
  if (/model.*not found|NOT_FOUND/i.test(raw)) {
    return { status: 500, message: `A Gemini model was not found (${cfg.generationModel} / ${cfg.embeddingModel}). Set GEMINI_MODEL / GEMINI_EMBEDDING_MODEL to valid model names.` };
  }
  if (/vector|dimension/i.test(raw) && /expected|different/i.test(raw)) {
    return { status: 500, message: "Embedding size doesn't match the database column. Keep GEMINI_EMBEDDING_DIMENSIONS the same as when the tables were created." };
  }
  return { status: 500, message: raw ? (raw.length > 300 ? raw.slice(0, 300) + "…" : raw) : "Internal server error." };
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const { status, message } = friendlyError(err);
  if (status === 500 && !(err instanceof HttpError)) console.error("Unhandled server error:", err);
  if (res.headersSent) return res.end();
  res.status(status).json({ error: message });
});

export default app;
