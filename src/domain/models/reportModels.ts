import type {
  Crop,
  FarmProfile,
  FinancialScenarioSet,
  PestRisk,
  RecommendationResult,
  SoilGapAnalysisResult,
} from "./models";
import type { CalendarDay, CropCalendarPlan } from "../../engine/cropCalendarEngine";
import type { MarketDemand } from "../../services/marketplace/marketplaceClient";

/**
 * One 7-day bucket of the cultivation calendar, aggregated from `CalendarDay[]` — pure
 * arithmetic/dedup over data `cropCalendarEngine.ts` already produced, nothing invented. See
 * `engine/reportEngine.ts#buildWeeklyPlan`.
 */
export interface WeeklyPlanGroup {
  weekIndex: number;
  startDateIso: string;
  endDateIso: string;
  /** Phase(s) this week overlaps, in chronological order (a week can straddle a phase change). */
  phases: string[];
  /** Deduplicated task strings across every day in this week — the week's "goals". */
  goals: string[];
  /** Deduplicated risk/pest strings across every day in this week. */
  watchOuts: string[];
  milestoneCount: number;
}

/**
 * Everything the Full Farm Report PDF renders, assembled once from data every engine already
 * computed elsewhere in the app (recommendation engine, soil-gap analysis, financial engine,
 * pest dataset, cultivation calendar, marketplace demand). This module never invents a number —
 * see `engine/reportEngine.ts` and [[krishi-mitra-ai-boundary]].
 */
export interface FarmReportData {
  generatedAtIso: string;
  farmerName: string | null;
  profile: FarmProfile;
  crop: Crop;
  recommendation: RecommendationResult;
  allRecommendations: RecommendationResult[];
  gapAnalysis: SoilGapAnalysisResult;
  financials: FinancialScenarioSet;
  pestRisks: PestRisk[];
  calendarPlan: CropCalendarPlan;
  weeklyPlan: WeeklyPlanGroup[];
  marketDemand: MarketDemand | null;
}
