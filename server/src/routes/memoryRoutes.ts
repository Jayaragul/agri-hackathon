/**
 * Long-term memory routes, mounted under `/api` by `server/src/index.ts`. Thin wrappers over
 * `memoryService.ts` — all the "never throw, degrade to empty" behaviour lives there.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getMemoryBackend } from "../services/memoryService";

const SESSION_ID_RE = /^[A-Za-z0-9-]{1,100}$/;

const RecordMemoryInputSchema = z.object({
  role: z.enum(["farmer", "assistant"]),
  text: z.string().min(1).max(4000),
});

export function createMemoryRoutes(): Router {
  const router = Router();

  router.post("/sessions/:sessionId/memory", async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    if (!SESSION_ID_RE.test(sessionId)) {
      return res.status(400).json({ error: "invalid_session_id" });
    }
    const parsed = RecordMemoryInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body" });
    }

    await getMemoryBackend().record(sessionId, parsed.data.role, parsed.data.text);
    return res.status(204).send();
  });

  router.get("/sessions/:sessionId/memory", async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    if (!SESSION_ID_RE.test(sessionId)) {
      return res.status(400).json({ error: "invalid_session_id" });
    }
    const query = typeof req.query.query === "string" ? req.query.query.slice(0, 600) : "";
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(20, Math.floor(limitRaw)) : undefined;

    const memories = await getMemoryBackend().recall(sessionId, query, limit);
    return res.status(200).json({ memories });
  });

  return router;
}
