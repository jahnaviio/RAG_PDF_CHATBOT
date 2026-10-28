import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTsQuery, detectMode, evenSample, extractCited, extractKeywords, isSmallTalk, parseCookies, percentile, rrfFuse, type Hit } from "../src/server/pure.js";
import { createLineParser } from "../src/lib/stream.js";
import { splitPage } from "../src/lib/chunk.js";

const hit = (docId: string, chunkIndex: number, score = 0.5): Hit => ({ docId, docName: docId, chunkIndex, pageNumber: 1, text: "t", score });

test("extractKeywords drops stopwords, keeps numbers", () => {
  assert.deepEqual(extractKeywords("What is week 1 of the NLP schedule?"), ["week", "1", "nlp", "schedule"]);
  const k = extractKeywords("What is week 12 about tokenization?");
  assert.ok(k.includes("12") && k.includes("tokenization") && k.includes("week"));
  assert.ok(!k.includes("what") && !k.includes("is"));
});

test("buildTsQuery makes an OR query and strips symbols", () => {
  assert.equal(buildTsQuery(["bert", "tokeniz'ation", "a&b"]), "bert | tokenization | ab");
  assert.equal(buildTsQuery([]), "");
});

test("rrfFuse rewards chunks found by both searches", () => {
  const vector = [hit("d", 1), hit("d", 2), hit("d", 3)];
  const keyword = [hit("d", 3), hit("d", 9)];
  const fused = rrfFuse([vector, keyword]);
  // chunk 3 appears in both lists (ranks 3 and 1) and must beat chunk 2 (only vector rank 2)
  const pos = (i: number) => fused.findIndex((h) => h.chunkIndex === i);
  assert.ok(pos(3) < pos(2));
  assert.equal(fused.length, 4);
});

test("isSmallTalk", () => {
  for (const s of ["hi", "Hello!", "hey there", "thanks", "thank you so much", "how are you", "good morning"]) assert.equal(isSmallTalk(s), true, s);
  for (const s of ["hi explain transformers", "what is NLP", "thanks, but what about week 2?"]) assert.equal(isSmallTalk(s), false, s);
});

test("detectMode", () => {
  assert.equal(detectMode("Generate a 5-question quiz."), "quiz");
  assert.equal(detectMode("quiz me on unit 2"), "quiz");
  assert.equal(detectMode("Please make flashcards for key terms"), "flashcards");
  assert.equal(detectMode("Summarize this document in a few bullet points."), "summary");
  assert.equal(detectMode("What is a quiz in the document?"), "chat");
  assert.equal(detectMode("What does week 3 say?"), "chat");
});

test("extractCited handles single, grouped and out-of-range markers", () => {
  assert.deepEqual(extractCited("A [Source Block #2]. B [Source Block #1, #3] C [Source Block #9]", 4), [1, 2, 3]);
  assert.deepEqual(extractCited("no citations", 4), []);
});

test("evenSample covers the document within budget", () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ i, t: "x".repeat(100) }));
  const s = evenSample(items, 2000, (x) => x.t.length);
  assert.ok(s.length <= 20 && s.length >= 15);
  assert.equal(s[0].i, 0);
  assert.ok(s[s.length - 1].i > 80);
  assert.equal(evenSample(items.slice(0, 5), 2000, (x) => x.t.length).length, 5);
});

test("parseCookies", () => {
  assert.deepEqual(parseCookies("a=1; rag_session=abc%20def; b=2"), { a: "1", rag_session: "abc def", b: "2" });
  assert.deepEqual(parseCookies(undefined), {});
});

test("percentile", () => {
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(percentile([], 95), 0);
});

test("NDJSON line parser reassembles split chunks and skips junk", () => {
  const seen: any[] = [];
  const p = createLineParser((e) => seen.push(e));
  p.push('{"type":"meta","a":1}\n{"type":"del');
  p.push('ta","text":"hi"}\nnot json\n{"type":"done"}');
  p.flush();
  assert.deepEqual(seen.map((e) => e.type), ["meta", "delta", "done"]);
});

test("splitPage produces overlapping chunks under the size limit", () => {
  const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} talks about natural language processing.`).join(" ");
  const chunks = splitPage(text);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 1100));
});
