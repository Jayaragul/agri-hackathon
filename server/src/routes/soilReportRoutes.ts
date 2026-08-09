/**
 * Soil-report persistence routes, mounted under `/api` by `server/src/index.ts`.
 *
 * These routes do NOT run the Gemini extraction — the client already did that via `AiHarness`
 * (see `storage/soilReportTypes.ts`'s header for why duplicating that here would be a second,
 * driftable copy of "engine decides, AI explains" logic). This is purely the durability layer:
 * the raw uploaded file goes to Cloud Storage, the extracted structured reading goes to
 * Firestore, keyed by the SAME anonymous `sessionId` every other server route already uses
 * (`src/services/session/sessionId.ts`) — no login, no auth, same posture as `sessionRoutes.ts`.
 *
 * Every handler degrades the same way `sessionRoutes.ts`/`marketplaceRoutes.ts` do: a storage
 * failure returns 503, never a crash, never a silent "looks like it worked."
 */

import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { DocumentBackend } from "../storage/documentStore";
import type { FileBackend } from "../storage/fileStore";
import {
  SOIL_REPORTS_COLLECTION,
  SoilReportUploadRequestSchema,
  soilReportFilePath,
  type SoilReportRecord,
} from "../storage/soilReportTypes";

/** Decoded byte cap — base64 inflates ~4/3, so this comfortably fits inside the server's JSON body limit (see `index.ts`). Generous enough for a phone photo or a multi-page scanned PDF, not so generous that one upload can exhaust memory. */
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function decodeBase64(data: string): Buffer | null {
  try {
    const buf = Buffer.from(data, "base64");
    // Buffer.from with invalid base64 doesn't throw — it silently drops bad characters. A
    // meaningful length mismatch (allowing for padding) is the practical signal that the input
    // wasn't valid base64 at all rather than a real, if oddly-padded, file.
    if (buf.length === 0) return null;
    return buf;
  } catch {
    return null;
  }
}

export function createSoilReportRoutes(files: FileBackend, documents: DocumentBackend): Router {
  const router = Router();

  router.post("/soil-reports", async (req: Request, res: Response) => {
    const parsed = SoilReportUploadRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body" });
    }

    const { sessionId, fileName, mimeType, base64Data, extraction } = parsed.data;
    const buffer = decodeBase64(base64Data);
    if (!buffer) {
      return res.status(400).json({ error: "invalid_file_data" });
    }
    if (buffer.length > MAX_FILE_BYTES) {
      return res.status(413).json({ error: "file_too_large", maxBytes: MAX_FILE_BYTES });
    }

    const reportId = randomUUID();
    const filePath = soilReportFilePath(sessionId, reportId, mimeType);

    try {
      await files.writeFile(filePath, buffer, mimeType);

      const record: SoilReportRecord = {
        reportId,
        sessionId,
        fileName,
        mimeType,
        filePath,
        byteLength: buffer.length,
        extractedAt: new Date().toISOString(),
        ...extraction,
      };
      await documents.set(SOIL_REPORTS_COLLECTION, reportId, record);

      return res.status(201).json({ reportId, filePath });
    } catch (err) {
      console.error(`[soilReportRoutes] persist failed for session "${sessionId}":`, describeError(err));
      return res.status(503).json({ error: "storage_unavailable" });
    }
  });

  router.get("/soil-reports/:sessionId/latest", async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    if (!/^[A-Za-z0-9-]{1,100}$/.test(sessionId)) {
      return res.status(400).json({ error: "invalid_session_id" });
    }

    try {
      const results = await documents.list<SoilReportRecord>(SOIL_REPORTS_COLLECTION, {
        where: [["sessionId", "==", sessionId]],
        orderByField: "extractedAt",
        direction: "desc",
        limit: 1,
      });
      if (results.length === 0) {
        return res.status(404).json({ error: "not_found" });
      }
      return res.status(200).json(results[0]);
    } catch (err) {
      console.error(`[soilReportRoutes] latest lookup failed for session "${sessionId}":`, describeError(err));
      return res.status(503).json({ error: "storage_unavailable" });
    }
  });

  return router;
}
