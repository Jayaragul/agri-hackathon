/**
 * Frontend client for the soil-report durability layer (`server/src/routes/soilReportRoutes.ts`).
 *
 * This does NOT run the Gemini extraction — `GeminiSoilReportExtractor.ts` already did that via
 * `AiHarness` by the time anything here is called. This client's only job is telling the server
 * "here is the original file and the reading we already computed from it, please keep a durable
 * copy" — the same "advisory, never blocking the real feature" posture `marketplaceClient.ts`
 * already uses: a farmer's lab-report upload must succeed from their point of view (the reading
 * is already applied to their profile) whether or not this persistence call succeeds.
 */
import type { SoilReportExtraction } from "../ai/contracts/aiSchemas";
import type { InlineImage } from "../ai/contracts/aiTypes";

function readApiBase(): string {
  try {
    const raw = import.meta.env.VITE_API_BASE_URL;
    return typeof raw === "string" ? raw.trim().replace(/\/$/, "") : "";
  } catch {
    return "";
  }
}

export interface PersistSoilReportInput {
  sessionId: string;
  fileName: string;
  image: InlineImage;
  extraction: SoilReportExtraction;
}

export interface PersistedSoilReport {
  reportId: string;
  filePath: string;
}

/**
 * Upload the original file + already-computed extraction for durable, cross-device storage
 * (Cloud Storage for the file, Firestore for the structured reading). Never throws — returns
 * `null` on any failure (no backend deployed, network error, non-2xx), which the caller must
 * treat as "not durably saved yet," never as "the reading itself failed" (it didn't; it's
 * already in the farmer's local profile via `toPartialProfile`/`setLabReport`).
 */
export async function persistSoilReport(input: PersistSoilReportInput): Promise<PersistedSoilReport | null> {
  try {
    const response = await fetch(`${readApiBase()}/api/soil-reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: input.sessionId,
        fileName: input.fileName,
        mimeType: input.image.mimeType,
        base64Data: input.image.base64Data,
        extraction: input.extraction,
      }),
    });
    if (!response.ok) return null;
    return (await response.json()) as PersistedSoilReport;
  } catch {
    return null;
  }
}

/**
 * The most recent durably-stored reading for this session, or `null` if none exists / the
 * backend isn't reachable. Used to restore a farmer's lab report on a NEW device/browser —
 * `services/identity/labReport.ts`'s `localStorage` copy is device-bound, this is not.
 */
export async function getLatestSoilReport(sessionId: string): Promise<SoilReportExtraction | null> {
  try {
    const response = await fetch(`${readApiBase()}/api/soil-reports/${encodeURIComponent(sessionId)}/latest`);
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<SoilReportExtraction> & Record<string, unknown>;
    if (typeof body.documentRecognised !== "boolean") return null;
    return {
      ph: (body.ph as number | null) ?? null,
      nitrogenKgPerAcre: (body.nitrogenKgPerAcre as number | null) ?? null,
      phosphorusKgPerAcre: (body.phosphorusKgPerAcre as number | null) ?? null,
      potassiumKgPerAcre: (body.potassiumKgPerAcre as number | null) ?? null,
      documentRecognised: body.documentRecognised,
      confidence: (body.confidence as SoilReportExtraction["confidence"]) ?? "low",
      warnings: Array.isArray(body.warnings) ? (body.warnings as string[]) : [],
    };
  } catch {
    return null;
  }
}
