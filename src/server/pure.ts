/**
 * Pure helpers (no network, no database) so they are easy to unit test.
 */

export type StudyMode = "chat" | "summary" | "quiz" | "flashcards";
export const STUDY_MODES: StudyMode[] = ["chat", "summary", "quiz", "flashcards"];
export const isStudyMode = (v: unknown): v is StudyMode => typeof v === "string" && (STUDY_MODES as string[]).includes(v);

export interface Hit {
  docId: string;
  docName: string;
  chunkIndex: number;
  pageNumber: number;
  text: string;
  /** cosine similarity with the question (0..1) */
  score: number;
  /** reciprocal-rank-fusion score, set after fusion */
  rrf?: number;
}

export const hitKey = (h: Pick<Hit, "docId" | "chunkIndex">) => `${h.docId}:${h.chunkIndex}`;

// ---------------------------------------------------------------- keywords

const STOPWORDS = new Set(
  (
    "a about above after again against all also am an and any are aren't as at be because been before being below between both but by can can't cannot could couldn't " +
    "did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he her here hers herself him himself his how " +
    "i if in into is isn't it its itself just let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same " +
    "shan't she should shouldn't so some such than that the their theirs them themselves then there these they this those through to too under until up very was wasn't " +
    "we were weren't what when where which while who whom why with won't would wouldn't you your yours yourself yourselves " +
    "tell explain describe give show please pdf document file mean means meaning kind need want know like using use used get got make made " +
    "say said says does did really actually basically simply etc ie eg vs"
  ).split(/\s+/)
);

/** Meaningful search words from a natural-language question. */
export function extractKeywords(question: string, max = 12): string[] {
  const words = question.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const isNumber = /^\d+$/.test(w);
    if (w.length < 3 && !isNumber) continue; // "week 1" must keep the "1"
    if (STOPWORDS.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

/** Builds an OR query for to_tsquery, e.g. ["tokenization","bert"] -> "tokenization | bert". */
export function buildTsQuery(keywords: string[]): string {
  return keywords
    .map((k) => k.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter(Boolean)
    .join(" | ");
}

// -------------------------------------------------------------- hybrid search

/**
 * Reciprocal Rank Fusion. Merges several ranked lists (vector search, keyword search)
 * into one ranking without having to compare their incompatible raw scores.
 */
export function rrfFuse(lists: Hit[][], k = 60): Hit[] {
  const merged = new Map<string, { hit: Hit; rrf: number }>();
  for (const list of lists) {
    list.forEach((hit, rank) => {
      const key = hitKey(hit);
      const add = 1 / (k + rank + 1);
      const current = merged.get(key);
      if (current) current.rrf += add;
      else merged.set(key, { hit: { ...hit }, rrf: add });
    });
  }
  return [...merged.values()].sort((a, b) => b.rrf - a.rrf).map((x) => ({ ...x.hit, rrf: x.rrf }));
}

// ------------------------------------------------------------- conversation

const GREETING_START =
  /^(hi+|hello+|hey+|heya|hola|yo|sup|namaste|good (morning|afternoon|evening|night)|thanks|thank you|thx|ty|ok|okay|cool|great|nice|awesome|bye|goodbye|how are you|what's up|whats up|wassup)\b/;
const FILLER = new Set(
  "there buddy bro friend you so much again all everyone bot assistant man dude sir mam maam how are doing today is it going up a lot very guys team mate pal dear chatbot claude gemini".split(" ")
);

/** "hi", "thanks", "how are you": no need to search the PDF for these. */
export function isSmallTalk(question: string): boolean {
  const s = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return true;
  const m = s.match(GREETING_START);
  if (!m) return false;
  const rest = s.slice(m[0].length).trim();
  if (!rest) return true;
  return rest.split(" ").every((w) => FILLER.has(w));
}

const POLITE = "(?:please\\s+|pls\\s+|can you\\s+|could you\\s+|i want you to\\s+)?";

/** Recognises explicit study-tool requests typed as free text. */
export function detectMode(question: string): StudyMode {
  const s = question.trim().toLowerCase();
  if (/^quiz me\b/.test(s)) return "quiz";
  if (new RegExp(`^${POLITE}(generate|make|create|give me|write|prepare|build)\\b.{0,40}\\b(quiz|quizzes|mcqs?|multiple[- ]choice|test questions)\\b`).test(s)) return "quiz";
  if (new RegExp(`^${POLITE}(generate|make|create|give me|write|prepare|build)\\b.{0,40}\\bflash\\s?cards?\\b`).test(s)) return "flashcards";
  if (new RegExp(`^${POLITE}(summari[sz]e|give me a summary|write a summary|summary of|tl;?dr)\\b`).test(s)) return "summary";
  return "chat";
}

/** Which "[Source Block #n]" markers did the model actually use? */
export function extractCited(text: string, sourceCount: number): number[] {
  const found = new Set<number>();
  const bracket = /\[Source Blocks?\s*([^\]]*)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = bracket.exec(text))) {
    for (const num of m[1].matchAll(/\d+/g)) {
      const v = Number(num[0]);
      if (v >= 1 && v <= sourceCount) found.add(v);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** Pick evenly spaced items so a long document is covered start to end within a character budget. */
export function evenSample<T>(items: T[], maxChars: number, size: (t: T) => number): T[] {
  const total = items.reduce((s, it) => s + size(it), 0);
  if (total <= maxChars || items.length <= 1) return items;
  const avg = total / items.length;
  const target = Math.max(1, Math.floor(maxChars / avg));
  const picked: T[] = [];
  let used = 0;
  for (let j = 0; j < target; j++) {
    const item = items[Math.floor((j * items.length) / target)];
    const s = size(item);
    if (used + s > maxChars && picked.length > 0) break;
    picked.push(item);
    used += s;
  }
  return picked;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    const raw = part.slice(i + 1).trim();
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
