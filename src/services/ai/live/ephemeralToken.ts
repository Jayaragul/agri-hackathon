/**
 * Fetches a short-lived Gemini Live API token from this app's own backend
 * (`server/src/routes/liveRoutes.ts`) — the browser never sees `GEMINI_API_KEY`. Requires the
 * backend to be deployed with `GEMINI_API_KEY` configured; with no backend or no key, this
 * throws and the caller (`CropDoctorSession`) surfaces that as "Crop Doctor is unavailable"
 * rather than silently degrading, since there is no meaningful offline equivalent of a live
 * video call.
 */
import type { PestRisk } from "../../../domain/models/models";

export interface EphemeralLiveToken {
  token: string;
  expireTime: string;
  model: string;
}

/**
 * Mirrors the server's `FarmerContextSummary` (`server/src/services/cropDoctorConfig.ts`) —
 * assembled by `services/context/farmContext.ts` so Video mode knows the same farmer identity,
 * soil numbers, recent events, and upcoming predictions every other agent does. Keep both copies
 * in sync by hand; there is no shared module between the frontend and `server/`.
 */
export interface FarmerContextSummary {
  farmerName?: string;
  situation?: string;
  /** One line of soil numbers (profile or uploaded lab report) — see `farmContext.ts`'s `summariseSoilNumbers`. */
  soilSummary?: string;
  /** Reactive: recent farm-timeline entries, most recent first — see `services/timeline/farmTimeline.ts`. */
  recentEvents?: string[];
  /** Proactive: engine-computed upcoming milestones/risk windows — see `engine/proactiveEngine.ts`. */
  upcomingAlerts?: string[];
}

// Direct `import.meta.env.KEY` access, not an aliased `const meta = import.meta; meta.env`
// indirection — see the comment on `resolveEnvSource` in `services/ai/runtime/harnessConfig.ts`
// for why the indirect form silently resolves to nothing under Vite's dev-mode client injection.
function readApiBase(): string {
  try {
    const raw = import.meta.env.VITE_API_BASE_URL;
    return typeof raw === "string" ? raw.trim().replace(/\/$/, "") : "";
  } catch {
    return "";
  }
}

/** Only names/symptoms are sent — never treatment text, which stays dataset-only until a match is resolved client-side. */
export function toCandidateSummaries(pests: PestRisk[]): Array<{ id: string; pestName: string; symptoms: string }> {
  return pests.map((p) => ({ id: p.id, pestName: p.pestName, symptoms: p.symptoms }));
}

export async function fetchLiveToken(
  cropName: string,
  candidates: PestRisk[],
  farmerContext?: FarmerContextSummary,
  resumptionHandle?: string
): Promise<EphemeralLiveToken> {
  const apiBase = readApiBase();
  const response = await fetch(`${apiBase}/api/live/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cropName,
      candidates: toCandidateSummaries(candidates),
      farmerContext,
      resumptionHandle,
    }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: string };
      detail = body?.error ?? "";
    } catch {
      detail = "";
    }
    throw new Error(detail || `Could not start Crop Doctor (HTTP ${response.status}).`);
  }

  return (await response.json()) as EphemeralLiveToken;
}
