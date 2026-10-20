/**
 * Reads a fetch Response as JSON without ever throwing the cryptic
 * "Unexpected token 'R', "Request En"... is not valid JSON" error.
 * If the server (or the hosting platform) answered with plain text/HTML,
 * a readable message is produced instead.
 */
export async function readJson<T = any>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    if (response.status === 413) {
      throw new Error("File is too large for the live demo. Maximum size is 3MB.");
    }
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 120);
    throw new Error(
      `Server returned an unexpected response (HTTP ${response.status})${snippet ? `: ${snippet}` : ""}`
    );
  }
}

/** Throws a readable Error for non-2xx responses, otherwise returns parsed JSON. */
export async function requestJson<T = any>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data: any = await readJson(response);
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (HTTP ${response.status}).`);
  }
  return data as T;
}
