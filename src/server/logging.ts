import { query } from "./db.js";

export interface RequestLog {
  userId?: string | null;
  kind: "chat" | "upload";
  scope?: string;
  mode?: string;
  status: number;
  latencyMs: number;
  retrievalMs?: number;
  ttftMs?: number;
  promptTokens?: number;
  outputTokens?: number;
  error?: string;
}

/**
 * Observability: one structured JSON line per request (visible in Vercel Logs) plus a row
 * in request_logs for the /api/metrics dashboard. Never throws.
 */
export async function logRequest(log: RequestLog): Promise<void> {
  console.log(JSON.stringify({ event: "request", ...log, userId: undefined, user: log.userId?.slice(0, 6) }));
  try {
    await query(
      `insert into request_logs (user_id, kind, scope, mode, status, latency_ms, retrieval_ms, ttft_ms, prompt_tokens, output_tokens, error)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        log.userId ?? null,
        log.kind,
        log.scope ?? null,
        log.mode ?? null,
        log.status,
        Math.round(log.latencyMs),
        log.retrievalMs ?? null,
        log.ttftMs ?? null,
        log.promptTokens ?? null,
        log.outputTokens ?? null,
        log.error ? log.error.slice(0, 300) : null,
      ]
    );
  } catch (err) {
    console.warn("Could not write request log:", (err as Error)?.message);
  }
}
