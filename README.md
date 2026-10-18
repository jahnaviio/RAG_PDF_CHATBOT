# 📚 RAG PDF Knowledge Assistant

**Retrieval-Augmented Generation (RAG) | Semantic Search | Gemini-Powered Document Intelligence**

Upload a PDF and ask natural-language questions about it. The app extracts the text, splits it into overlapping chunks, embeds each chunk, retrieves the most relevant chunks for a question by cosine similarity, and asks Gemini to answer using only that retrieved context — citing the source chunk and page it used.

---

## 🚀 Features

- Upload a PDF; text is extracted and split into overlapping chunks automatically.
- Each chunk is converted to a vector embedding and kept in an in-memory store for the session.
- Questions are embedded the same way and matched against stored chunks by cosine similarity.
- The top 5 matching chunks are passed to Gemini as grounding context, with a system prompt that tells it to say so explicitly if the answer isn't in the document, rather than guessing.
- Answers cite which source chunk and estimated page they came from.

---

## 🛠️ Tech Stack

| Category          | Technology                              |
| ------------------ | ---------------------------------------- |
| Language            | TypeScript                               |
| Frontend            | React 19, Vite, Tailwind CSS             |
| Backend             | Node.js, Express                         |
| LLM & Embeddings    | Google Gemini API (`gemini-3.6-flash`, `gemini-embedding-2`) |
| PDF Processing      | pdf-parse                                |
| Vector Store        | In-memory, cosine similarity (per server instance) |
| Deployment          | Vercel (serverless function under `/api`) |

---

## 📂 Project Structure
