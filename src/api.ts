import { createLineParser } from "./lib/stream";

/** Error that carries the HTTP status so callers can react (e.g. retry on 429). */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Called when the server says the session expired, so the app can show the login page. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

/**
 * Reads a fetch Response as JSON without ever throwing the cryptic
 * "Unexpected token 'R', "Request En"... is not valid JSON" error.
 * If the server (or Vercel itself) answers with plain text/HTML, a readable
 * message is produced instead.
 */
async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    if (response.status === 413) {
      throw new ApiError(413, "The request was too large for the server. Please try a smaller document.");
    }
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 120);
    throw new ApiError(
      response.status,
      `Server returned an unexpected response (HTTP ${response.status})${snippet ? `: ${snippet}` : ""}`
    );
  }
}

async function send(input: RequestInfo, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your internet connection and try again.");
  }
}

async function failFrom(response: Response): Promise<never> {
  let message = `Request failed (HTTP ${response.status}).`;
  try {
    const data = await readJson(response);
    if (data?.error) message = data.error;
  } catch (err: any) {
    message = err?.message || message;
  }
  if (response.status === 401) onUnauthorized?.();
  throw new ApiError(response.status, message);
}

/** POST/GET JSON and throw a readable ApiError for any non-2xx response. */
export async function requestJson<T = any>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await send(input, init);
  if (!response.ok) return failFrom(response);
  return (await readJson(response)) as T;
}

export const postJson = <T = any>(url: string, body: unknown) =>
  requestJson<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** POST JSON and consume a newline-delimited JSON stream, calling onEvent for every event. */
export async function streamNdjson(url: string, body: unknown, onEvent: (event: any) => void): Promise<void> {
  const response = await send(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return failFrom(response);
  if (!response.body) throw new ApiError(500, "Your browser doesn't support streaming responses.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = createLineParser((event) => {
    if (event?.type === "error") throw new ApiError(500, event.message || "The answer was interrupted.");
    onEvent(event);
  });
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.flush();
}
