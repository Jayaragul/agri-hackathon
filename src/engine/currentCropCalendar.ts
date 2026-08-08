/**
 * Assembles the SAME cultivation-calendar plan `CropCalendar.tsx` renders, from just
 * profile/crop/recommendation — the one place that wires together soil-gap analysis, the crop's
 * pest list, and the deterministic calendar engine, so the UI and `services/context/farmContext.ts`
 * (proactive alerts, shared with every agent) can never compute two different plans for the same
 * farm from two different call sites.
 */
import { analyzeSoilGaps } from "./soilGapAnalysis";
import { buildCropCalendar, type CropCalendarPlan } from "./cropCalendarEngine";
import { sampleCorrections } from "../data/sample/corrections";
import { samplePests } from "../data/sample/pests";
import type { Crop, FarmProfile, RecommendationResult } from "../domain/models/models";

export function deriveCurrentCropCalendarPlan(
  profile: FarmProfile,
  crop: Crop,
  recommendation: RecommendationResult
): CropCalendarPlan {
  const gapAnalysis = analyzeSoilGaps(profile, crop, sampleCorrections, recommendation);
  const pestRisks = samplePests.filter((p) => p.cropId === crop.id);
  return buildCropCalendar({ profile, crop, recommendation, gapAnalysis, pestRisks });
}
