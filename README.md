# 📚 RAG PDF Knowledge Assistant

**Chat with any PDF.** Upload a document, ask questions in plain English, and get answers grounded in the file, with page citations.

## How it works

1. **Read** – the PDF is parsed *in your browser* with `pdf.js` (no file upload, so no server size limits).
2. **Chunk** – each page is split into overlapping ~1000-character chunks.
3. **Embed** – chunks are sent in small batches to `/api/embed`, which calls Gemini embeddings (768-dim vectors).
4. **Search** – your question is embedded the same way and matched against the chunks by cosine similarity, in the browser.
5. **Answer** – the top 5 chunks go to `/api/answer`, where Gemini writes an answer using only that context, citing `[Source Block #n]`.

The server is **stateless** (it only holds the Gemini key), so it works on Vercel serverless without a database.

## Tech stack

React 19 · Vite · Tailwind CSS 4 · TypeScript · Express (Vercel serverless function under `/api`) · Google Gemini (`gemini-2.5-flash`, `gemini-embedding-001`) · pdf.js · react-markdown

## Run locally

```bash
npm install
cp .env.example .env      # then put your key in GEMINI_API_KEY
npm run dev               # http://localhost:3000
```

## Deploy on Vercel

1. Import the repo in Vercel.
2. Add the environment variable **`GEMINI_API_KEY`** (Project Settings → Environment Variables).
3. Deploy. Optional overrides: `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`, `GEMINI_EMBEDDING_DIMENSIONS`.

Check `https://<your-app>.vercel.app/api/health` – it should show `"geminiKeyConfigured": true`.

## Limits

- Text-based PDFs only (scanned/image PDFs have no text to read), up to 25MB / 600 chunks.
- Documents live in the browser tab; refreshing clears them.
- Free Gemini tier has rate limits; the app waits and retries automatically.
