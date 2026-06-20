export interface DocumentMetadata {
  id: string;
  name: string;
  size: number; // in bytes
  uploadTime: string;
  pageCount: number;
  chunkCount: number;
  totalCharacters: number;
}

export interface Chunk {
  id: string;
  text: string;
  pageNumber: number;
  score?: number; // Similarity score for retrieval
}

export interface QueryResponse {
  answer: string;
  retrievedChunks: Chunk[];
  question: string;
  timestamp: string;
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
}
