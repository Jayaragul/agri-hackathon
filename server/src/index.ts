/**
 * Krishi Mitra backend entry point.
 *
 * Serves the JSON API under `/api` (see `routes/sessionRoutes.ts`) plus the built frontend
 * (`../dist`, produced by `npm run build` at the project root — see the root `Dockerfile`) as
 * static files, so the whole app ships as one Cloud Run container.
 *
 * The storage backend (GCS vs. in-memory) is resolved exactly once here at startup — see
 * `storage/bucketStore.ts` for why.
 */

import path from "node:path";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { createStorageBackend } from "./storage/bucketStore";
import { createSessionRoutes } from "./routes/sessionRoutes";
import { createAiRoutes } from "./routes/aiRoutes";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10) || 8080;

// Project root's `dist/`, built by the frontend build step. This file runs from
// `server/dist/index.js` at runtime, so `../../dist` reaches `<root>/dist`.
const FRONTEND_DIST = path.resolve(__dirname, "..", "..", "dist");

function main(): void {
  const storage = createStorageBackend();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/api", createSessionRoutes(storage));
  app.use("/api", createAiRoutes());

  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim());
  console.log(`Gemini proxy: ${geminiConfigured ? "configured" : "no GEMINI_API_KEY set — /api/ai/generate will 503"}`);

  // Serve the built SPA. Static assets first (so real files with a matching name are returned
  // as-is and 404 normally if missing); a catch-all fallback to index.html handles client-side
  // routing for everything else that isn't an API/health path.
  app.use(express.static(FRONTEND_DIST));

  app.get(/^\/(?!api\/|healthz).*/, (req: Request, res: Response, next: NextFunction) => {
    // If the path looks like a static asset request (has a file extension) and wasn't served
    // above, let it 404 normally instead of masking it with index.html.
    if (path.extname(req.path)) {
      return next();
    }
    res.sendFile(path.join(FRONTEND_DIST, "index.html"), (err) => {
      if (err) next(err);
    });
  });

  app.listen(PORT, () => {
    console.log(`Krishi Mitra server listening on port ${PORT}`);
  });
}

main();
