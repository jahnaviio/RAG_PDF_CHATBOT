import "dotenv/config";

const int = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/** Every tunable lives here, read once from environment variables. */
export const cfg = {
  generationModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
  embeddingDims: int(process.env.GEMINI_EMBEDDING_DIMENSIONS, 768),

  // Abuse protection, because friends share your Gemini key.
  dailyMessageLimit: int(process.env.DAILY_MESSAGE_LIMIT, 60),
  maxDocsPerUser: int(process.env.MAX_DOCS_PER_USER, 15),
  dailyChunkLimit: int(process.env.DAILY_CHUNK_LIMIT, 2500),

  // Retrieval
  rerank: process.env.ENABLE_RERANK === "true",
  adminEmails: (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
};

export const hasGeminiKey = () => Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY");
export const databaseUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
export const googleClientId = () => process.env.GOOGLE_CLIENT_ID || "";
export const hasAuthSecret = () => (process.env.AUTH_SECRET || "").length >= 16;
