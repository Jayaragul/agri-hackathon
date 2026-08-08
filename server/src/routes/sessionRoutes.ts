/**
 * Session persistence routes, mounted under `/api` by `server/src/index.ts`.
 *
 * There is no login/auth in this app — `sessionId` is an opaque anonymous per-device UUID the
 * frontend generates and sends. Validation here is input hygiene only (the bucket path is built
 * straight from `sessionId`/`dateIso`, so path-breaking characters must be rejected) — not an
 * auth system.
 *
 * Every handler is wrapped so a storage failure returns `500 { error: "storage_unavailable" }`
 * rather than crashing the process, mirroring the "never throw into a caller" rule the frontend's
 * `AiHarness` enforces for AI calls.
 */

import { Router, type Request, type Response } from "express";
import type { StorageBackend } from "../storage/bucketStore";
import {
  ChatMessageInputSchema,
  ChatThreadSchema,
  SessionSnapshotInputSchema,
  advisorChatPath,
  calendarChatPath,
  profilePath,
  type ChatMessage,
} from "../storage/types";

const SESSION_ID_RE = /^[A-Za-z0-9-]{1,100}$/;
const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}

function isValidDateIso(value: string): boolean {
  return DATE_ISO_RE.test(value);
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Shared read-append-write for any chat thread path — calendar-day and advisor threads both use this. */
async function appendToThread(storage: StorageBackend, path: string, input: ReturnType<typeof ChatMessageInputSchema.parse>): Promise<ChatMessage[]> {
  const existing = await storage.readJson(path);
  const existingThread = ChatThreadSchema.safeParse(existing);
  const thread: ChatMessage[] = existingThread.success ? existingThread.data : [];

  thread.push({
    role: input.role,
    text: input.text,
    citedFacts: input.citedFacts,
    source: input.source,
    timestamp: new Date().toISOString(),
  });

  await storage.writeJson(path, thread);
  return thread;
}

async function readThread(storage: StorageBackend, path: string): Promise<ChatMessage[]> {
  const existing = await storage.readJson(path);
  const existingThread = ChatThreadSchema.safeParse(existing);
  return existingThread.success ? existingThread.data : [];
}

export function createSessionRoutes(storage: StorageBackend): Router {
  const router = Router();

  // ---- PUT /api/sessions/:sessionId/profile --------------------------------
  router.put("/sessions/:sessionId/profile", async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    if (!isValidSessionId(sessionId)) {
      return res.status(400).json({ error: "invalid_session_id" });
    }

    const parsed = SessionSnapshotInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body" });
    }

    try {
      const snapshot = {
        sessionId,
        farmProfile: parsed.data.farmProfile,
        selectedCropId: parsed.data.selectedCropId ?? null,
        savedAt: new Date().toISOString(),
      };
      await storage.writeJson(profilePath(sessionId), snapshot);
      return res.status(204).send();
    } catch (err) {
      console.error(`[sessionRoutes] PUT profile failed for "${sessionId}":`, describeError(err));
      return res.status(500).json({ error: "storage_unavailable" });
    }
  });

  // ---- GET /api/sessions/:sessionId/profile ---------------------------------
  router.get("/sessions/:sessionId/profile", async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    if (!isValidSessionId(sessionId)) {
      return res.status(400).json({ error: "invalid_session_id" });
    }

    try {
      const snapshot = await storage.readJson(profilePath(sessionId));
      if (snapshot === null) {
        return res.status(404).json({ error: "not_found" });
      }
      return res.status(200).json(snapshot);
    } catch (err) {
      console.error(`[sessionRoutes] GET profile failed for "${sessionId}":`, describeError(err));
      return res.status(500).json({ error: "storage_unavailable" });
    }
  });

  // ---- POST /api/sessions/:sessionId/calendar/:dateIso/messages -------------
  router.post(
    "/sessions/:sessionId/calendar/:dateIso/messages",
    async (req: Request, res: Response) => {
      const { sessionId, dateIso } = req.params;
      if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ error: "invalid_session_id" });
      }
      if (!isValidDateIso(dateIso)) {
        return res.status(400).json({ error: "invalid_date" });
      }

      const parsed = ChatMessageInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "invalid_body" });
      }

      try {
        const thread = await appendToThread(storage, calendarChatPath(sessionId, dateIso), parsed.data);
        return res.status(200).json(thread);
      } catch (err) {
        console.error(
          `[sessionRoutes] POST calendar message failed for "${sessionId}"/"${dateIso}":`,
          describeError(err)
        );
        return res.status(500).json({ error: "storage_unavailable" });
      }
    }
  );

  // ---- GET /api/sessions/:sessionId/calendar/:dateIso/messages ---------------
  router.get(
    "/sessions/:sessionId/calendar/:dateIso/messages",
    async (req: Request, res: Response) => {
      const { sessionId, dateIso } = req.params;
      if (!isValidSessionId(sessionId)) {
        return res.status(400).json({ error: "invalid_session_id" });
      }
      if (!isValidDateIso(dateIso)) {
        return res.status(400).json({ error: "invalid_date" });
      }

      try {
        const thread = await readThread(storage, calendarChatPath(sessionId, dateIso));
        return res.status(200).json(thread);
      } catch (err) {
        console.error(
          `[sessionRoutes] GET calendar messages failed for "${sessionId}"/"${dateIso}":`,
          describeError(err)
        );
        return res.status(500).json({ error: "storage_unavailable" });
      }
    }
  );

  // ---- POST /api/sessions/:sessionId/advisor/messages ------------------------
  router.post("/sessions/:sessionId/advisor/messages", async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    if (!isValidSessionId(sessionId)) {
      return res.status(400).json({ error: "invalid_session_id" });
    }

    const parsed = ChatMessageInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body" });
    }

    try {
      const thread = await appendToThread(storage, advisorChatPath(sessionId), parsed.data);
      return res.status(200).json(thread);
    } catch (err) {
      console.error(`[sessionRoutes] POST advisor message failed for "${sessionId}":`, describeError(err));
      return res.status(500).json({ error: "storage_unavailable" });
    }
  });

  // ---- GET /api/sessions/:sessionId/advisor/messages -------------------------
  router.get("/sessions/:sessionId/advisor/messages", async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    if (!isValidSessionId(sessionId)) {
      return res.status(400).json({ error: "invalid_session_id" });
    }

    try {
      const thread = await readThread(storage, advisorChatPath(sessionId));
      return res.status(200).json(thread);
    } catch (err) {
      console.error(`[sessionRoutes] GET advisor messages failed for "${sessionId}":`, describeError(err));
      return res.status(500).json({ error: "storage_unavailable" });
    }
  });

  return router;
}
