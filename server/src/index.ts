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
import { createDocumentBackend } from "./storage/documentStore";
import { createFileBackend, createMarketplaceArchiveBackend } from "./storage/fileStore";
import { createSessionRoutes } from "./routes/sessionRoutes";
import { createAiRoutes } from "./routes/aiRoutes";
import { createLiveRoutes } from "./routes/liveRoutes";
import { createMemoryRoutes } from "./routes/memoryRoutes";
import { createVoiceRoutes } from "./routes/voiceRoutes";
import { createWeatherRoutes } from "./routes/weatherRoutes";
import { createMarketplaceRoutes } from "./routes/marketplaceRoutes";
import { createSoilReportRoutes } from "./routes/soilReportRoutes";
import { createCommunityRoutes } from "./routes/communityRoutes";
import { createAgentTraceRoutes } from "./routes/agentTraceRoutes";
import { getMemoryBackend } from "./services/memoryService";
import { resolveGeminiApiKey, resolveSarvamApiKey, resolveWeatherApiKey } from "./services/env";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10) || 8080;

// Project root's `dist/`, built by the frontend build step. This file runs from
// `server/dist/index.js` at runtime, so `../../dist` reaches `<root>/dist`.
const FRONTEND_DIST = path.resolve(__dirname, "..", "..", "dist");

function main(): void {
  const storage = createStorageBackend();
  const documents = createDocumentBackend();
  const files = createFileBackend();
  const marketplaceArchive = createMarketplaceArchiveBackend();

  const app = express();
  app.use(cors());
  // 15MB, not 5MB: a soil-report upload's JSON body carries a base64-encoded photo/PDF, which
  // inflates the raw file size by ~4/3. `MAX_FILE_BYTES` in `soilReportRoutes.ts` caps the
  // decoded file itself at 10MB — this just has to be large enough to let that request's JSON
  // envelope through before the route-level check ever runs.
  app.use(express.json({ limit: "15mb" }));

  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/api", createSessionRoutes(storage));
  app.use("/api", createAiRoutes());
  app.use("/api", createLiveRoutes());
  app.use("/api", createMemoryRoutes());
  app.use("/api", createVoiceRoutes());
  app.use("/api", createWeatherRoutes());
  app.use("/api", createMarketplaceRoutes(documents, marketplaceArchive));
  app.use("/api", createSoilReportRoutes(files, documents));
  app.use("/api", createCommunityRoutes(marketplaceArchive));
  app.use("/api", createAgentTraceRoutes(documents, files));
  getMemoryBackend(); // resolved eagerly so its startup log appears alongside storage/Gemini

  console.log(`Gemini proxy: ${resolveGeminiApiKey() ? "configured" : "no GEMINI_API_KEY set — /api/ai/generate will 503"}`);
  console.log(`Sarvam proxy (Audio Mode): ${resolveSarvamApiKey() ? "configured" : "no SARVAM_API_KEY set — /api/voice/* will 503"}`);
  console.log(`Weather proxy: ${resolveWeatherApiKey() ? "configured" : "no GOOGLE_WEATHER_API_KEY set — /api/weather/forecast will 503"}`);

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
    console.log(`Thulir server listening on port ${PORT}`);
  });
}

main();
