/**
 * Live-session routes, mounted under `/api` by `server/src/index.ts`.
 *
 * `POST /api/live/token` is the only endpoint: it mints one ephemeral Gemini Live API token
 * (see `liveTokenService.ts`) and returns it to the browser, which then connects directly to
 * Google's Live API WebSocket — this server never proxies the audio/video stream itself.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { createLiveToken, LiveTokenError } from "../services/liveTokenService";

const MAX_CANDIDATES = 20;

const CandidateSchema = z.object({
  id: z.string().min(1).max(50),
  pestName: z.string().min(1).max(120),
  symptoms: z.string().max(500),
});

const FarmerContextSchema = z.object({
  farmerName: z.string().min(1).max(80).optional(),
  situation: z.string().min(1).max(400).optional(),
  soilSummary: z.string().min(1).max(200).optional(),
  recentEvents: z.array(z.string().max(300)).max(10).optional(),
  upcomingAlerts: z.array(z.string().max(300)).max(10).optional(),
});

const LiveTokenRequestSchema = z.object({
  cropName: z.string().min(1).max(100),
  candidates: z.array(CandidateSchema).max(MAX_CANDIDATES),
  farmerContext: FarmerContextSchema.optional(),
  /** Present only on an automatic reconnect after an unexpected disconnect — carries the Gemini-issued session-resumption handle forward so the conversation survives the new token. */
  resumptionHandle: z.string().max(4000).optional(),
});

export function createLiveRoutes(): Router {
  const router = Router();

  router.post("/live/token", async (req: Request, res: Response) => {
    const parsed = LiveTokenRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body" });
    }

    try {
      const result = await createLiveToken(
        parsed.data.cropName,
        parsed.data.candidates,
        parsed.data.farmerContext,
        parsed.data.resumptionHandle
      );
      return res.status(200).json(result);
    } catch (err) {
      const status = err instanceof LiveTokenError ? err.status : 500;
      const message = err instanceof Error ? err.message : "Unexpected error minting a live token.";
      if (status >= 500) console.error("[liveRoutes] token mint failed:", message);
      return res.status(status).json({ error: message });
    }
  });

  return router;
}
