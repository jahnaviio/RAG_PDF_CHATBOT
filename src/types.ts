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
  docName?: string; // only set when chatting across several PDFs
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Chunk[];
  /** which [Source Block #n] markers the answer actually used (1-based) */
  cited?: number[];
  /** search words, used to highlight the matching passage in a source */
  terms?: string[];
  error?: boolean;
  streaming?: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string | null;
}

/** "general" (no PDF), "all" (every PDF), or a document id. */
export type Scope = string;
export type StudyMode = "chat" | "summary" | "quiz" | "flashcards";

export type IndexStage = "reading" | "chunking" | "embedding";

export interface IndexProgress {
  fileName: string;
  stage: IndexStage;
  percent: number;
  message: string;
}
