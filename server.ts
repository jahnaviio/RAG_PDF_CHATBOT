import fs from "fs/promises";
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
        const templatePath = path.join(process.cwd(), "index.html");
        const raw = await fs.readFile(templatePath, "utf-8");
        // transformIndexHtml injects the Vite client + React refresh preamble
        const html = await vite.transformIndexHtml(req.originalUrl, raw);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
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
