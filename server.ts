import path from "path";
import { createServer as createViteServer } from "vite";
import app from "./src/ragApp.js";

const PORT = Number(process.env.PORT) || 3000;

async function setupViteAndListen() {
  // On Vercel, api/[[...slug]].ts handles all requests and the static site is
  // served by Vercel's own build output — this file and its Vite/listen logic
  // are for local development and local `npm start` only.
  if (process.env.VERCEL) {
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);

    app.use("*", async (req, res, next) => {
      try {
        const template = `<!doctype html>
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
    const distPath = path.join(process.cwd(), "dist");
    const express = (await import("express")).default;
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
