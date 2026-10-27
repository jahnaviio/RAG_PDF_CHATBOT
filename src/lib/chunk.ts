export const CHUNK_SIZE = 1000; // characters
export const CHUNK_OVERLAP = 200; // characters

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split one page into overlapping ~CHUNK_SIZE blocks on sentence/paragraph boundaries. */
export function splitPage(text: string): string[] {
  const clean = normalizeText(text);
  if (!clean) return [];

  const rawSegments = clean
    .split(/(?<=[.!?])\s+|\n{2,}|\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Hard-split any segment that is still longer than one chunk.
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
      // carry trailing segments over as overlap
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
