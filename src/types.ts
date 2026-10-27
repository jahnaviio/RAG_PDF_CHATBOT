export interface DocumentMetadata {
  id: string;
  name: string;
  size: number; // bytes
  uploadTime: string;
  pageCount: number;
  chunkCount: number;
  totalCharacters: number;
}

export interface Chunk {
  id: string;
  text: string;
  pageNumber: number;
  score?: number; // cosine similarity, set on retrieved chunks
}

export interface IndexedChunk extends Chunk {
  embedding: number[];
}

/** A document's full vector index. It lives in the browser, never on the server. */
export interface DocumentIndex {
  metadata: DocumentMetadata;
  chunks: IndexedChunk[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Chunk[];
  error?: boolean;
}

export type IndexStage = "reading" | "chunking" | "embedding";

export interface IndexProgress {
  fileName: string;
  stage: IndexStage;
  percent: number;
  message: string;
}
