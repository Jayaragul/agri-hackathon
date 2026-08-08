/**
 * A soil-report reading captured via the `extract-soil-report` A2A skill, independent of the
 * full wizard `FarmProfile` — so a farmer who only ever uses Audio Mode (Audio Mode is the app's
 * default landing screen; most farmers may never walk the pre-sowing wizard) still gets real
 * soil-number grounding instead of the model guessing. `localStorage`-scoped to this device,
 * mirroring `farmerIdentity.ts`. Read by `services/context/farmContext.ts` alongside `profile`;
 * when the farmer later does complete the wizard, `FarmProfileForm.tsx` pre-fills from this so
 * the same lab report photo is never re-typed by hand.
 */
import type { SoilReportExtraction } from "../ai/contracts/aiSchemas";

const LAB_REPORT_KEY = "krishi-mitra.lab-report";

let cachedLabReport: SoilReportExtraction | null | undefined;

function isValidExtraction(value: unknown): value is SoilReportExtraction {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    "ph" in v &&
    "nitrogenKgPerAcre" in v &&
    "phosphorusKgPerAcre" in v &&
    "potassiumKgPerAcre" in v &&
    typeof v.documentRecognised === "boolean"
  );
}

/** The most recently captured lab report reading, or `null` if none has been uploaded yet. Never throws. */
export function getLabReport(): SoilReportExtraction | null {
  if (cachedLabReport !== undefined) return cachedLabReport;
  try {
    const raw = localStorage.getItem(LAB_REPORT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    cachedLabReport = isValidExtraction(parsed) ? parsed : null;
  } catch {
    cachedLabReport = null;
  }
  return cachedLabReport;
}

/** Persist a freshly-read lab report — see `useVoiceConversation.ts`'s `uploadLabReport`. */
export function setLabReport(extraction: SoilReportExtraction): void {
  cachedLabReport = extraction;
  try {
    localStorage.setItem(LAB_REPORT_KEY, JSON.stringify(extraction));
  } catch {
    // Best-effort only — the in-memory cache above still lets the current session work.
  }
}

/** Resets to "not yet read" (not merely `null`) so the next `getLabReport()` re-derives from storage rather than trusting a stale in-memory value — the same "drop the cache, rebuild fresh" contract as `services/ai/index.ts`'s `resetAiSingletons()`. Tests rely on this to isolate cases. */
export function clearLabReport(): void {
  cachedLabReport = undefined;
  try {
    localStorage.removeItem(LAB_REPORT_KEY);
  } catch {
    // Best-effort only.
  }
}
