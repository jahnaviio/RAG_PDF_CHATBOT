/** Error that carries the HTTP status so callers can react (e.g. retry on 429). */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
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

/** POST/GET JSON and throw a readable ApiError for any non-2xx response. */
export async function requestJson<T = any>(input: RequestInfo, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your internet connection and try again.");
  }
  const data = await readJson(response);
  if (!response.ok) {
    throw new ApiError(response.status, data?.error || `Request failed (HTTP ${response.status}).`);
  }
  return data as T;
}
