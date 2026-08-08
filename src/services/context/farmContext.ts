/**
 * The single place that assembles "who is this farmer, and what is their situation right now"
 * for whichever agent/LLM is currently active — Audio Mode, the text Farm Advisor, and the Video
 * Mode (Crop Doctor) live persona all read this same snapshot instead of each re-deriving it from
 * `farmStore` their own way. This is what makes "the model exactly needs to know the name, the
 * crop, current situation" true everywhere at once rather than in one screen.
 *
 * Pure data assembly only — never calls an LLM, never mutates the store. Per
 * [[krishi-mitra-ai-boundary]], this feeds the AI's "explains/perceives" layer; the deterministic
 * engine's own state (`useFarmStore`) remains the sole source of truth it reads from.
 */
import { useFarmStore } from "../../state/farmStore";
import type { Crop, FarmProfile, FarmTimelineEvent, RecommendationResult } from "../../domain/models/models";
import type { SoilReportExtraction } from "../ai/contracts/aiSchemas";
import { deriveCurrentCropCalendarPlan } from "../../engine/currentCropCalendar";
import { buildProactiveAlerts, describeProactiveAlert } from "../../engine/proactiveEngine";

/** How many reactive events / proactive alerts ride along in a snapshot — enough to ground an answer, short enough to never bloat a prompt. */
const RECENT_EVENTS_LIMIT = 5;
const UPCOMING_ALERTS_LIMIT = 5;

export interface FarmContextSnapshot {
  farmerName: string | null;
  profile: FarmProfile | null;
  crop: Crop | null;
  topRecommendation: RecommendationResult | null;
  /**
   * Whatever the farmer has volunteered in conversation, verbatim — the fallback for every
   * farmer who never walks the profile wizard (which, since Audio Mode is the app's default
   * landing screen, may be most of them). Farmer-reported, never engine-verified: every prompt
   * that surfaces it labels it that way, identically to how mem0 memories are framed. `null`
   * until the farmer has said something substantial in Audio Mode.
   */
  declaredSituation: string | null;
  /** Soil numbers read off a photographed lab report, independent of the wizard `profile` — see `services/identity/labReport.ts`. `null` until a farmer uploads one. */
  labReport: SoilReportExtraction | null;
  /** Reactive: what actually happened, most recent first — see `services/timeline/farmTimeline.ts`. Farmer/agent-reported, never engine-verified. */
  recentEvents: FarmTimelineEvent[];
  /** Proactive: what the deterministic calendar predicts next (milestones, newly-opening pest-risk windows) — engine-computed, per [[krishi-mitra-ai-boundary]]. Empty until profile + crop + a matching recommendation all exist. */
  upcomingAlerts: FarmTimelineEvent[];
}

/** Read the current farmer/farm/crop state directly from the store, outside React render. */
export function getFarmContextSnapshot(): FarmContextSnapshot {
  const { farmerName, profile, selectedCrop, recommendations, declaredSituation, labReport, timelineEvents } =
    useFarmStore.getState();

  let upcomingAlerts: FarmTimelineEvent[] = [];
  const matchingRecommendation = selectedCrop
    ? recommendations.find((r) => r.crop.id === selectedCrop.id) ?? null
    : null;
  if (profile && selectedCrop && matchingRecommendation) {
    try {
      const plan = deriveCurrentCropCalendarPlan(profile, selectedCrop, matchingRecommendation);
      upcomingAlerts = buildProactiveAlerts(plan, new Date()).slice(0, UPCOMING_ALERTS_LIMIT);
    } catch {
      // Best-effort only — a malformed plan should never break context assembly for every agent.
      upcomingAlerts = [];
    }
  }

  return {
    farmerName,
    profile,
    crop: selectedCrop,
    topRecommendation: recommendations[0] ?? null,
    declaredSituation,
    labReport,
    recentEvents: timelineEvents.slice(0, RECENT_EVENTS_LIMIT),
    upcomingAlerts,
  };
}

/**
 * One-line soil summary from whichever source is available — the wizard profile's own numbers
 * when present, otherwise a farmer-uploaded lab report. Unlike `summariseSituation()` (which
 * only mentions soil via the lab-report fallback, since the typed Advisor already gets full
 * profile detail from `farmKnowledgeBase.ts`'s `summariseFarmContext`), Crop Doctor Live never
 * gets that detail otherwise — this is what closes that gap.
 */
export function summariseSoilNumbers(ctx: FarmContextSnapshot): string | undefined {
  if (ctx.profile) {
    const p = ctx.profile;
    return `pH ${p.ph}, N ${p.nitrogenKgPerAcre}, P ${p.phosphorusKgPerAcre}, K ${p.potassiumKgPerAcre} kg/acre`;
  }
  const lab = ctx.labReport;
  if (!lab || !lab.documentRecognised) return undefined;
  const parts: string[] = [];
  if (lab.ph !== null) parts.push(`pH ${lab.ph}`);
  if (lab.nitrogenKgPerAcre !== null) parts.push(`N ${lab.nitrogenKgPerAcre}`);
  if (lab.phosphorusKgPerAcre !== null) parts.push(`P ${lab.phosphorusKgPerAcre}`);
  if (lab.potassiumKgPerAcre !== null) parts.push(`K ${lab.potassiumKgPerAcre}`);
  return parts.length > 0 ? `${parts.join(", ")} kg/acre (from uploaded lab report)` : undefined;
}

/** One-line soil summary used ONLY as `summariseSituation()`'s fallback when no wizard profile exists — see `summariseSoilNumbers` above for the source-agnostic version used elsewhere (Crop Doctor Live). */
function summariseSoil(ctx: FarmContextSnapshot): string | undefined {
  if (ctx.profile) return undefined; // already covered by the "growing X" branch below via profile.region/acres — avoid repeating pH/NPK twice in one line.
  const lab = ctx.labReport;
  if (!lab || !lab.documentRecognised) return undefined;
  const parts: string[] = [];
  if (lab.ph !== null) parts.push(`pH ${lab.ph}`);
  if (lab.nitrogenKgPerAcre !== null) parts.push(`N ${lab.nitrogenKgPerAcre}`);
  if (lab.phosphorusKgPerAcre !== null) parts.push(`P ${lab.phosphorusKgPerAcre}`);
  if (lab.potassiumKgPerAcre !== null) parts.push(`K ${lab.potassiumKgPerAcre}`);
  return parts.length > 0 ? `lab report: ${parts.join(", ")} kg/acre` : undefined;
}

/**
 * One-line, human-readable summary of the farmer's situation — used where a full structured
 * context object doesn't fit (e.g. the Crop Doctor Live token request, which only carries a
 * short string alongside the crop name it already sends separately). Falls back to whatever the
 * farmer has declared in conversation when the wizard hasn't been walked yet.
 */
export function summariseSituation(ctx: FarmContextSnapshot): string | undefined {
  const parts: string[] = [];
  if (ctx.crop) parts.push(`growing ${ctx.crop.name}`);
  if (ctx.profile?.region) parts.push(`in ${ctx.profile.region}`);
  if (ctx.profile?.acres) parts.push(`on ${ctx.profile.acres} acres`);
  if (ctx.topRecommendation) parts.push(`top recommendation: ${ctx.topRecommendation.crop.name} (${ctx.topRecommendation.decisionStatus})`);
  if (parts.length === 0 && ctx.declaredSituation) parts.push(`farmer says: ${ctx.declaredSituation}`);

  const soil = summariseSoil(ctx);
  if (soil) parts.push(soil);

  if (ctx.upcomingAlerts.length > 0) parts.push(`upcoming: ${describeProactiveAlert(ctx.upcomingAlerts[0])}`);
  if (ctx.recentEvents.length > 0) parts.push(`recently: ${ctx.recentEvents[0].title}`);

  return parts.length > 0 ? parts.join(", ") : undefined;
}
