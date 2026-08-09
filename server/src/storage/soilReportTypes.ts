/**
 * Zod-validated shape, collection name, and file-path builder for durably-persisted soil-report
 * extractions — the server-side half of `GeminiSoilReportExtractor.ts` / `labReport.ts`'s
 * client-side (`localStorage`-only, single-device) capture.
 *
 * Split across both backends, each doing what it's actually good at:
 *   - The ORIGINAL uploaded file (photo or PDF) — binary, never queried, occasionally
 *     re-examined by a human — goes to Cloud Storage via `fileStore.ts`.
 *   - The EXTRACTED structured reading (ph, N/P/K, confidence, provenance) — small, structured,
 *     needs to be queried "give me this farmer's latest reading" — goes to Firestore via
 *     `documentStore.ts`.
 *
 * This route/store never re-runs the Gemini extraction itself — `extract-soil-report` already
 * runs correctly today via `AiHarness` (client-direct or through `ServerProxyTransport`
 * depending on `VITE_AI_TRANSPORT`); duplicating that prompt/schema here would be a second,
 * driftable copy of "engine decides, AI explains only" logic. This layer's ONLY job is
 * persistence of a result the client already computed and validated — see
 * `SoilReportUploadSchema` below re-validating the shape defensively on the way in, the same
 * "never trust the network, even your own frontend" posture `sessionRoutes.ts` already applies.
 */

import { z } from "zod";

export const SOIL_REPORTS_COLLECTION = "soil_reports";

/** Mirrors `src/services/ai/contracts/aiSchemas.ts`'s `ConfidenceEnum` — hand-mirrored across the frontend/backend boundary, same convention already used for `DemandTier`. */
export const ConfidenceSchema = z.enum(["low", "medium", "high"]);

/** Mirrors `SoilReportExtractionSchema` (frontend) exactly — this server re-validates rather than trusting whatever the client already validated once. */
export const SoilReportExtractionSchema = z.object({
  ph: z.number().min(0).max(14).nullable(),
  nitrogenKgPerAcre: z.number().min(0).max(500).nullable(),
  phosphorusKgPerAcre: z.number().min(0).max(500).nullable(),
  potassiumKgPerAcre: z.number().min(0).max(500).nullable(),
  documentRecognised: z.boolean(),
  confidence: ConfidenceSchema,
  warnings: z.array(z.string()),
});

export type SoilReportExtractionInput = z.infer<typeof SoilReportExtractionSchema>;

export const ALLOWED_SOIL_REPORT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"] as const;

export const SoilReportUploadRequestSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9-]{1,100}$/, "invalid sessionId"),
  fileName: z.string().min(1).max(200),
  mimeType: z.enum(ALLOWED_SOIL_REPORT_MIME_TYPES),
  base64Data: z.string().min(1),
  extraction: SoilReportExtractionSchema,
});

export type SoilReportUploadRequest = z.infer<typeof SoilReportUploadRequestSchema>;

export const SoilReportRecordSchema = z.object({
  reportId: z.string().min(1),
  sessionId: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  filePath: z.string().min(1),
  byteLength: z.number().int().min(0),
  extractedAt: z.string(),
  ph: z.number().min(0).max(14).nullable(),
  nitrogenKgPerAcre: z.number().min(0).max(500).nullable(),
  phosphorusKgPerAcre: z.number().min(0).max(500).nullable(),
  potassiumKgPerAcre: z.number().min(0).max(500).nullable(),
  documentRecognised: z.boolean(),
  confidence: ConfidenceSchema,
  warnings: z.array(z.string()),
});

export type SoilReportRecord = z.infer<typeof SoilReportRecordSchema>;

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

export function extensionForMimeType(mimeType: string): string {
  return MIME_EXTENSIONS[mimeType] ?? "bin";
}

/** `soil-reports/{sessionId}/{reportId}.{ext}` — same "sessionId as the top-level namespace" convention `storage/types.ts` already uses for `sessions/{sessionId}/...`. */
export function soilReportFilePath(sessionId: string, reportId: string, mimeType: string): string {
  return `soil-reports/${sessionId}/${reportId}.${extensionForMimeType(mimeType)}`;
}
