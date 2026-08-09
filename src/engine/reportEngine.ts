/**
 * Assembles the Full Farm Report (PDF) data set. Pure aggregation over data every other engine
 * already computed — `recommendationEngine.ts`, `soilGapAnalysis.ts`, `financialEngine.ts`, the
 * pest dataset, `cropCalendarEngine.ts` — plus one new transform, `buildWeeklyPlan`, that groups
 * the day-by-day calendar into 7-day buckets. Nothing here calls AI or invents a figure; the
 * report explains and formats, it never originates a number. See [[krishi-mitra-ai-boundary]].
 */
import type { CalendarDay, CropCalendarPlan } from "./cropCalendarEngine";
import { PHASE_LABELS } from "./cropCalendarEngine";
import type {
  Crop,
  FarmProfile,
  FinancialScenarioSet,
  PestRisk,
  RecommendationResult,
  SoilGapAnalysisResult,
} from "../domain/models/models";
import type { FarmReportData, WeeklyPlanGroup } from "../domain/models/reportModels";
import type { MarketDemand } from "../services/marketplace/marketplaceClient";

/** Groups a calendar's days into 7-day buckets, anchored at the first day (which may be negative — pre-sowing prep days share week 0 with early growing days rather than getting their own partial week). */
export function buildWeeklyPlan(days: CalendarDay[]): WeeklyPlanGroup[] {
  if (days.length === 0) return [];

  const sorted = [...days].sort((a, b) => a.dayIndex - b.dayIndex);
  const firstDayIndex = sorted[0].dayIndex;

  const buckets = new Map<number, CalendarDay[]>();
  for (const day of sorted) {
    const weekIndex = Math.floor((day.dayIndex - firstDayIndex) / 7);
    const list = buckets.get(weekIndex) ?? [];
    list.push(day);
    buckets.set(weekIndex, list);
  }

  const weeks: WeeklyPlanGroup[] = [];
  const sortedWeekIndices = Array.from(buckets.keys()).sort((a, b) => a - b);
  for (const weekIndex of sortedWeekIndices) {
    const weekDays = buckets.get(weekIndex)!;
    const phases: string[] = [];
    const goals: string[] = [];
    const watchOuts: string[] = [];
    let milestoneCount = 0;

    for (const day of weekDays) {
      if (!phases.includes(day.phaseLabel)) phases.push(day.phaseLabel);
      for (const task of day.tasks) {
        if (!goals.includes(task)) goals.push(task);
      }
      for (const risk of day.risks) {
        if (!watchOuts.includes(risk)) watchOuts.push(risk);
      }
      if (day.isMilestone) milestoneCount += 1;
    }

    weeks.push({
      weekIndex,
      startDateIso: weekDays[0].dateIso,
      endDateIso: weekDays[weekDays.length - 1].dateIso,
      phases,
      goals,
      watchOuts,
      milestoneCount,
    });
  }

  return weeks;
}

export interface BuildFarmReportDataInput {
  farmerName: string | null;
  profile: FarmProfile;
  crop: Crop;
  recommendation: RecommendationResult;
  allRecommendations: RecommendationResult[];
  gapAnalysis: SoilGapAnalysisResult;
  financials: FinancialScenarioSet;
  pestRisks: PestRisk[];
  calendarPlan: CropCalendarPlan;
  marketDemand: MarketDemand | null;
  /** Injected so report generation is reproducible/testable rather than reading `Date.now()` internally. */
  now?: Date;
}

export function buildFarmReportData(input: BuildFarmReportDataInput): FarmReportData {
  const now = input.now ?? new Date();
  return {
    generatedAtIso: now.toISOString(),
    farmerName: input.farmerName,
    profile: input.profile,
    crop: input.crop,
    recommendation: input.recommendation,
    allRecommendations: input.allRecommendations,
    gapAnalysis: input.gapAnalysis,
    financials: input.financials,
    pestRisks: input.pestRisks,
    calendarPlan: input.calendarPlan,
    weeklyPlan: buildWeeklyPlan(input.calendarPlan.days),
    marketDemand: input.marketDemand,
  };
}

export { PHASE_LABELS };
