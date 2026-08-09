/**
 * AI Agent Trace persistence routes, mounted under `/api` by `server/src/index.ts`.
 *
 * `POST /api/agent-traces` appends one call record (fire-and-forget from the frontend — see
 * `src/services/ai/runtime/telemetryPersistence.ts`); `GET /api/agent-traces/:sessionId` returns
 * this session's history so a reload can hydrate `HarnessTelemetry` instead of starting empty.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { DocumentBackend } from "../storage/documentStore";
import type { FileBackend } from "../storage/fileStore";
import { AgentTraceRecordSchema } from "../storage/agentTraceTypes";
import { getAgentTraceStore } from "../services/agentTraceStore";

// Matches `services/session/sessionId.ts`'s generated UUID shape — same discipline as
// `sessionRoutes.ts`'s own `SESSION_ID_RE` for why this is restricted rather than "any string."
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;

const RecordTraceRequestSchema = AgentTraceRecordSchema.omit({ loggedAtIso: true });

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function createAgentTraceRoutes(documents: DocumentBackend, files?: FileBackend): Router {
  const router = Router();
  const store = getAgentTraceStore(documents, files);

  router.post("/agent-traces", async (req: Request, res: Response) => {
    const parsed = RecordTraceRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body" });
    }
    try {
      await store.recordTrace(parsed.data);
      return res.status(204).send();
    } catch (err) {
      console.error("[agentTraceRoutes] recordTrace failed:", describeError(err));
      return res.status(503).json({ error: "storage_unavailable" });
    }
  });

  router.get("/agent-traces/:sessionId", async (req: Request, res: Response) => {
    const parsed = z.object({ sessionId: z.string().regex(SESSION_ID_RE) }).safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_session_id" });
    }
    try {
      const records = await store.getRecentTraces(parsed.data.sessionId);
      return res.status(200).json({ records });
    } catch (err) {
      console.error("[agentTraceRoutes] getRecentTraces failed:", describeError(err));
      return res.status(503).json({ error: "storage_unavailable" });
    }
  });

  return router;
}
