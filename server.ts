import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { DocumentMetadata, Chunk, QueryResponse } from "./src/types.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

// Initialize Google Gen AI
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn("WARNING: GEMINI_API_KEY environment variable is not set. Ensure the Secrets panel has been configured.");
}

const ai = new GoogleGenAI({
  apiKey: apiKey,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

// Configure JSON body parsing with reasonable size limits for PDFs
app.use(express.json({ limit: "25mb" }));

// In-memory document and vector store
interface VectorDocument {
  metadata: DocumentMetadata;
  chunks: Chunk[];
  vectors: number[][]; // parallel to chunks list
}

const documentStore: Record<string, VectorDocument> = {};

// Helper: Cosine Similarity between two vector arrays of numbers
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Helper: Split text recursively by common breaks
function splitTextChunks(text: string, chunkSize = 1100, chunkOverlap = 250): { text: string; approxPage: number }[] {
  const result: { text: string; approxPage: number }[] = [];
  const charsCount = text.length;
  if (!text || charsCount === 0) return [];

  // Let's attempt to look for standard form feed splits or page indicators FIRST
  // to associate text with estimated pages
  const rawPages = text.split(/\f|\n\s*-+ Page \d+ -+\s*\n/i);
  let accumulatedChars = 0;
  const pageSegments: { text: string; pageNum: number; charStart: number; charEnd: number }[] = [];

  rawPages.forEach((pageText, idx) => {
    const pageNum = idx + 1;
    const cleanText = pageText.trim();
    if (cleanText) {
      const charStart = accumulatedChars;
      const charEnd = accumulatedChars + pageText.length;
      pageSegments.push({ text: pageText, pageNum, charStart, charEnd });
      accumulatedChars = charEnd;
    }
  });

  // If page splitting yielded normal segments, we can compute the page context
  // for any character index safely.
  const getPageNumForCharIndex = (index: number): number => {
    if (pageSegments.length === 0) return 1;
    for (const segment of pageSegments) {
      if (index >= segment.charStart && index <= segment.charEnd) {
        return segment.pageNum;
      }
    }
    return pageSegments[pageSegments.length - 1].pageNum;
  };

  let start = 0;
  while (start < charsCount) {
    let end = start + chunkSize;
    if (end > charsCount) {
      end = charsCount;
    } else {
      // Find a near clean boundary (sentence, paragraph, or space) to split at
      const windowRange = Math.floor(chunkSize * 0.25); // 25% overlap window
      const searchStart = end - windowRange;
      const subset = text.substring(searchStart, end);
      const boundaryIndex = Math.max(
        subset.lastIndexOf("\n\n"),
        subset.lastIndexOf(". "),
        subset.lastIndexOf("? "),
        subset.lastIndexOf(" ")
      );
      if (boundaryIndex !== -1) {
        end = searchStart + boundaryIndex + 1;
      }
    }

    const chunkText = text.substring(start, end).trim();
    if (chunkText.length > 10) {
      const approxPage = getPageNumForCharIndex(Math.floor((start + end) / 2));
      result.push({ text: chunkText, approxPage });
    }

    start = end - chunkOverlap;
    if (start >= charsCount - chunkOverlap) {
      break;
    }
    if (start < 0) {
      start = 0;
    }
  }

  return result;
}

// API Routes
// 1. Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// 2. Fetch list of currently loaded document metadatas
app.get("/api/documents", (req, res) => {
  const list = Object.values(documentStore).map((doc) => doc.metadata);
  res.json(list);
});

// 3. Remove a document from store
app.delete("/api/documents/:id", (req, res) => {
  const { id } = req.params;
  if (documentStore[id]) {
    delete documentStore[id];
    res.json({ success: true, message: "Document deleted from RAG memory successfully" });
  } else {
    res.status(404).json({ error: "Document not found" });
  }
});

// 4. Upload, extract page text, chunk, and create embeddings
app.post("/api/upload", async (req, res) => {
  try {
    const { fileBase64, fileName, fileSize } = req.body;
    if (!fileBase64) {
      return res.status(400).json({ error: "Missing file contents" });
    }

    // Convert base64 to buffer for PDF parsing
    const buffer = Buffer.from(fileBase64, "base64");
    
    // Parse PDF text using modern PDFParse
    let fullText = "";
    let pageCount = 1;
    try {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const textResult = await parser.getText();
      const infoResult = await parser.getInfo();
      fullText = textResult.text || "";
      pageCount = infoResult.total || 1;
    } catch (parseErr: any) {
      console.error("PDF Parsing error:", parseErr);
      return res.status(422).json({ error: `Failed to read PDF structure. Ensure it is a valid document. Original error: ${parseErr.message}` });
    }

    if (!fullText || fullText.trim().length === 0) {
      return res.status(422).json({ error: "This PDF contains no extractable text. Scanned images are not supported unless they incorporate OCR text layer." });
    }

    // Create chunks using recursive splitter
    const splitChunks = splitTextChunks(fullText);
    if (splitChunks.length === 0) {
      return res.status(422).json({ error: "Document text is too brief to split into semantic chunks." });
    }

    const documentId = "doc_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
    const totalChars = fullText.length;

    // Convert chunks to formal Chunk objects
    const formattedChunks: Chunk[] = splitChunks.map((c, i) => ({
      id: `${documentId}_chunk_${i}`,
      text: c.text,
      pageNumber: c.approxPage,
    }));

    // Generate embeddings for each chunk (throttling batches to avoid API bottlenecks)
    const embeddingVectors: number[][] = [];
    const textsToEmbed = formattedChunks.map(c => c.text);

    // Call embeddings API in segments of 8 parallel requests
    const batchSize = 8;
    for (let i = 0; i < textsToEmbed.length; i += batchSize) {
      const currentBatch = textsToEmbed.slice(i, i + batchSize);
      const batchPromises = currentBatch.map(async (text) => {
        try {
          const resp = await ai.models.embedContent({
            model: "gemini-embedding-2-preview",
            contents: text,
          });
          const embedData = resp as any;
          if (embedData?.embedding?.values) {
            return embedData.embedding.values;
          } else if (embedData?.embeddings?.[0]?.values) {
            return embedData.embeddings[0].values;
          }
          throw new Error("Missing embedding values inside response.");
        } catch (embedErr: any) {
          console.error("Failed chunk embedding:", embedErr);
          // Return a mock vector of zeros in worst case to avoid crashing the whole chain
          return new Array(768).fill(0);
        }
      });
      const batchResults = await Promise.all(batchPromises);
      embeddingVectors.push(...batchResults);
    }

    const docMetadata: DocumentMetadata = {
      id: documentId,
      name: fileName,
      size: fileSize || buffer.length,
      uploadTime: new Date().toISOString(),
      pageCount: pageCount,
      chunkCount: formattedChunks.length,
      totalCharacters: totalChars,
    };

    // Store inside memory-based RAG database
    documentStore[documentId] = {
      metadata: docMetadata,
      chunks: formattedChunks,
      vectors: embeddingVectors,
    };

    res.json({
      success: true,
      documentId,
      metadata: docMetadata,
    });
  } catch (err: any) {
    console.error("Server API Upload handler crash:", err);
    res.status(500).json({ error: `Internal Server Error: ${err.message || err}` });
  }
});

// 5. Query the vector DB + Generative Grounding
app.post("/api/query", async (req, res) => {
  try {
    const { documentId, question } = req.body;
    if (!documentId) {
      return res.status(400).json({ error: "Missing documentId parameter" });
    }
    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: "Missing question query input" });
    }

    const doc = documentStore[documentId];
    if (!doc) {
      return res.status(404).json({ error: "Requested PDF context could not be found. Please assist by re-uploading the PDF." });
    }

    // 1. Generate query embedding vector
    let queryVector: number[];
    try {
      const queryResp = await ai.models.embedContent({
        model: "gemini-embedding-2-preview",
        contents: question,
      });
      const queryEmbedData = queryResp as any;
      if (queryEmbedData?.embedding?.values) {
        queryVector = queryEmbedData.embedding.values;
      } else if (queryEmbedData?.embeddings?.[0]?.values) {
        queryVector = queryEmbedData.embeddings[0].values;
      } else {
        throw new Error("Failed to construct query vector properties");
      }
    } catch (embedErr: any) {
      console.error("Query embedding failure:", embedErr);
      return res.status(502).json({ error: "Unable to calculate embedding similarity. Check Gemini API state configuration." });
    }

    // 2. Perform semantic search matching (Cosine Similarity scan)
    const matches = doc.chunks.map((chunk, index) => {
      const score = cosineSimilarity(queryVector, doc.vectors[index]);
      return { chunk, score };
    });

    // Sort by descending correlation score
    matches.sort((a, b) => b.score - a.score);

    // Retrieve top context chunks (K=5 for generous references)
    const topMatches = matches.slice(0, 5);
    const retrievedChunks = topMatches.map(m => ({
      ...m.chunk,
      score: Math.round(m.score * 100) / 100, // round score to 2 decimal places
    }));

    // Generate strict prompt for model grounding
    const contextText = retrievedChunks
      .map((m, idx) => `[Source Block #${idx + 1}, estimated Page  ${m.pageNumber}]:\n${m.text}`)
      .join("\n\n---\n\n");

    const systemPrompt = `You are a professional PDF document expert. You must answer questions using only the provided document text source blocks below.
    
--- START RECEIVED TEXT SOURCE CONTEXT ---
${contextText}
--- END RECEIVED TEXT SOURCE CONTEXT ---

CRITICAL INSTRUCTIONS:
1. Provide a detailed, highly accurate explanation strictly grounded in the document context.
2. Maintain a professional, conversational, and direct formatting layout. Use rich markdown list details, bold labels, and structured headings for readability.
3. Cite your sources directly by referring to specific source blocks or estimated page numbers (e.g., "[Source Block #1 on Page X]"). Do NOT make up pages or reference blocks if you can help it.
4. If you look at the provided source context and find that the answer cannot be answered cleanly or is entirely missing, you MUST reply exactly with the following statement: "The uploaded document does not contain information related to this question." Do NOT try to hallucinate, supplement with external facts, or deduce from generic background intelligence. Always prioritize document authenticity.`;

    // 3. Ask Gemini to formulate contextual answer
    let responseText: string = "";
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: question,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.1, // low temperature locks answering accuracy to context blocks
        },
      });
      responseText = response.text || "No text return from intelligence engine.";
    } catch (genErr: any) {
      console.error("Generation error:", genErr);
      return res.status(502).json({ error: `AI Generation model error: ${genErr.message || genErr}` });
    }

    const payload: QueryResponse = {
      answer: responseText,
      retrievedChunks: retrievedChunks,
      question: question,
      timestamp: new Date().toISOString(),
    };

    res.json(payload);
  } catch (err: any) {
    console.error("Server API Query handler crash:", err);
    res.status(500).json({ error: `Internal Server Error: ${err.message || err}` });
  }
});

// Configure Vite middleware or production build output based on execution state
async function setupViteAndListen() {
  if (process.env.NODE_ENV !== "production") {
    // Development mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    
    // Serve index.html as fallback for SPAs in development
    app.use("*", async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>RAG PDF Knowledge Assistant</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`;
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        next(e);
      }
    });
  } else {
    // Production mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[RAG-PDF-Server] Running smoothly on host 0.0.0.0 and port ${PORT}`);
  });
}

setupViteAndListen().catch((err) => {
  console.error("Failed to start fullstack RAG PDF application server:", err);
});
