/**
 * Deterministic day-by-day cultivation calendar.
 *
 * Pure function: the same profile/crop/recommendation/gap-analysis/pest-list always produces
 * the same plan (the only external input, `referenceDate`, is injected rather than read from
 * `Date.now()` so this stays testable). Per [[krishi-mitra-ai-boundary]], phase boundaries are
 * generic phenological proportions of `crop.durationDays` — the dataset carries no per-crop
 * stage lengths, so this is stated as a generic staging, not crop-specific science — and every
 * task/risk attached to a day is copied verbatim from data an engine already computed
 * (`SoilGapAnalysisResult`, `PestRisk[]`, `Crop`). Nothing here is invented, which is what lets
 * `CalendarQueryAgent` answer "what about this day" grounded in a closed set of facts instead
 * of guessing.
 */
import type {
  Crop,
  DetectedGap,
  FarmProfile,
  PestRisk,
  RecommendationResult,
  SoilGapAnalysisResult,
} from "../domain/models/models";

export type CropCalendarPhase =
  | "soil-prep"
  | "germination"
  | "vegetative"
  | "flowering"
  | "maturation"
  | "harvest-window";

export interface CalendarDay {
  dateIso: string;
  /** Negative before sowing, 0 on sowing day, positive into the growing season. */
  dayIndex: number;
  phase: CropCalendarPhase;
  phaseLabel: string;
  tasks: string[];
  risks: string[];
  isMilestone: boolean;
}

export interface CropCalendarPlan {
  sowingDateIso: string;
  harvestDateIso: string;
  days: CalendarDay[];
}

export const PHASE_LABELS: Record<CropCalendarPhase, string> = {
  "soil-prep": "Soil Preparation",
  germination: "Germination",
  vegetative: "Vegetative Growth",
  flowering: "Flowering",
  maturation: "Maturation",
  "harvest-window": "Harvest Window",
};

/** Generic phenological proportions of total crop duration — not crop-specific staging data. */
const PHASE_BOUNDARIES: Array<{ phase: CropCalendarPhase; endFraction: number }> = [
  { phase: "germination", endFraction: 0.08 },
  { phase: "vegetative", endFraction: 0.35 },
  { phase: "flowering", endFraction: 0.65 },
  { phase: "maturation", endFraction: 0.92 },
  { phase: "harvest-window", endFraction: 1 },
];

function phaseForGrowingDay(dayIndex: number, durationDays: number): CropCalendarPhase {
  const fraction = durationDays > 0 ? dayIndex / durationDays : 1;
  for (const boundary of PHASE_BOUNDARIES) {
    if (fraction <= boundary.endFraction) return boundary.phase;
  }
  return "harvest-window";
}

function addDays(base: Date, days: number): Date {
  const result = new Date(base.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Format local calendar-date parts as `YYYY-MM-DD`. Deliberately NOT `date.toISOString()`,
 * which converts to UTC first — for any timezone ahead of UTC (India is UTC+5:30), local
 * midnight is still the previous day in UTC, so that would silently shift every date back by
 * one day for exactly the audience this app targets.
 */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Sowing date anchor: the 1st of the profile's chosen sowing month, in `referenceDate`'s year —
 * rolled forward a year if that month has already started before `referenceDate`, so the
 * calendar never opens showing a start date in the past.
 */
export function resolveSowingDate(profile: FarmProfile, referenceDate: Date): Date {
  const monthIndex = Math.min(Math.max(Math.floor(profile.currentMonth), 1), 12) - 1;
  const year = referenceDate.getFullYear();
  let sowing = new Date(year, monthIndex, 1);
  const referenceMonthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  if (sowing.getTime() < referenceMonthStart.getTime()) {
    sowing = new Date(year + 1, monthIndex, 1);
  }
  return sowing;
}

export interface BuildCropCalendarInput {
  profile: FarmProfile;
  crop: Crop;
  recommendation: RecommendationResult;
  gapAnalysis: SoilGapAnalysisResult;
  pestRisks: PestRisk[];
  referenceDate?: Date;
}

export function buildCropCalendar(input: BuildCropCalendarInput): CropCalendarPlan {
  const { profile, crop, gapAnalysis, pestRisks } = input;
  const referenceDate = input.referenceDate ?? new Date();
  const sowingDate = resolveSowingDate(profile, referenceDate);
  const prepDays = Math.max(0, Math.floor(gapAnalysis.maxDaysBeforeSowing));
  const durationDays = Math.max(1, Math.floor(crop.durationDays));

  const highRiskPests = pestRisks.filter((p) => p.riskLevel === "high").map((p) => p.pestName);
  const mediumRiskPests = pestRisks.filter((p) => p.riskLevel === "medium").map((p) => p.pestName);

  const gapsByStartOffset = new Map<number, DetectedGap[]>();
  for (const gap of gapAnalysis.gaps) {
    const wait = gap.correction?.minimumDaysBeforeSowing ?? 0;
    const offset = -wait;
    const list = gapsByStartOffset.get(offset) ?? [];
    list.push(gap);
    gapsByStartOffset.set(offset, list);
  }

  const days: CalendarDay[] = [];

  for (let offset = -prepDays; offset < 0; offset += 1) {
    const startingGaps = gapsByStartOffset.get(offset) ?? [];
    const tasks =
      startingGaps.length > 0
        ? startingGaps.map(
            (g) => `Start: ${g.correction?.displayName ?? g.gapLabel} — ${g.correction?.biologicalFix ?? "see soil corrections"}`
          )
        : ["Continue soil preparation."];
    days.push({
      dateIso: toIsoDate(addDays(sowingDate, offset)),
      dayIndex: offset,
      phase: "soil-prep",
      phaseLabel: PHASE_LABELS["soil-prep"],
      tasks,
      risks: [],
      isMilestone: startingGaps.length > 0,
    });
  }

  for (let dayIndex = 0; dayIndex <= durationDays; dayIndex += 1) {
    const phase = phaseForGrowingDay(dayIndex, durationDays);
    const previousPhase = dayIndex > 0 ? phaseForGrowingDay(dayIndex - 1, durationDays) : null;
    const tasks: string[] = [];
    const risks: string[] = [];
    let isMilestone = false;

    if (dayIndex === 0) {
      tasks.push(`Sow ${crop.name} today.`);
      isMilestone = true;
    } else if (phase !== previousPhase) {
      tasks.push(`${PHASE_LABELS[phase]} stage begins.`);
      isMilestone = true;
    }

    if (phase === "vegetative" || phase === "flowering") {
      risks.push(...highRiskPests);
      if (phase === "flowering") risks.push(...mediumRiskPests);
    }

    if (phase === "harvest-window" && dayIndex === durationDays) {
      tasks.push(
        `Estimated harvest window begins. Dataset average price is ₹${crop.marketPricePerKg}/kg — plan sale logistics.`
      );
      isMilestone = true;
    }

    days.push({
      dateIso: toIsoDate(addDays(sowingDate, dayIndex)),
      dayIndex,
      phase,
      phaseLabel: PHASE_LABELS[phase],
      tasks,
      risks: Array.from(new Set(risks)),
      isMilestone,
    });
  }

  return {
    sowingDateIso: toIsoDate(sowingDate),
    harvestDateIso: toIsoDate(addDays(sowingDate, durationDays)),
    days,
  };
}

export function findCalendarDay(plan: CropCalendarPlan, dateIso: string): CalendarDay | null {
  return plan.days.find((d) => d.dateIso === dateIso) ?? null;
}

/** Parse a `YYYY-MM-DD` string as a local-midnight `Date` — pairs with `toIsoDate`'s local formatting so round-tripping never shifts by a day. */
export function parseIsoDate(dateIso: string): Date {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}
