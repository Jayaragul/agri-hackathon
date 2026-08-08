import { describe, it, expect } from "vitest";
import { buildCropCalendar, findCalendarDay, resolveSowingDate } from "../engine/cropCalendarEngine";
import type { Crop, FarmProfile, PestRisk, RecommendationResult, SoilGapAnalysisResult } from "../domain/models/models";

const profile: FarmProfile = {
  acres: 1,
  ph: 6.5,
  nitrogenKgPerAcre: 80,
  phosphorusKgPerAcre: 40,
  potassiumKgPerAcre: 40,
  soilType: "Red Soil",
  region: "Coimbatore",
  currentMonth: 6,
};

const crop: Crop = {
  id: "test",
  name: "Test Crop",
  emoji: "🌱",
  category: "Test",
  season: [],
  sowingMonths: [],
  idealPhMin: 6.0,
  idealPhMax: 7.0,
  nitrogenRequired: 80,
  phosphorusRequired: 40,
  potassiumRequired: 40,
  compatibleSoilTypes: [],
  supportedRegions: [],
  averageYieldKgPerAcre: 1000,
  durationDays: 100,
  seedCostPerAcre: 0,
  fertilizerCostPerAcre: 0,
  pesticideCostPerAcre: 0,
  irrigationCostPerAcre: 0,
  laborCostPerAcre: 0,
  machineryCostPerAcre: 0,
  postHarvestCostPerAcre: 0,
  mandiChargesPerAcre: 0,
  marketPricePerKg: 25,
  wastagePercent: 0,
  description: "",
};

const recommendation: RecommendationResult = {
  crop,
  score: 90,
  confidence: "high",
  decisionStatus: "recommended",
  componentScores: { season: 0, sowingMonth: 0, ph: 0, nitrogen: 0, phosphorus: 0, potassium: 0, soilType: 0, region: 0 },
  positiveReasons: [],
  riskReasons: [],
  blockingWarnings: [],
  deficits: { nitrogenKgPerAcre: 0, phosphorusKgPerAcre: 0, potassiumKgPerAcre: 0 },
  trace: [],
};

const gapAnalysis: SoilGapAnalysisResult = {
  gaps: [
    {
      correctionKey: "low_nitrogen",
      severity: "warning",
      gapLabel: "Nitrogen Deficit",
      cropContext: "test",
      correction: {
        id: "c1",
        problemKey: "low_nitrogen",
        displayName: "Compost application",
        biologicalFix: "Apply 2 tonnes/acre farmyard manure.",
        estimatedCostPerAcre: 1000,
        minimumDaysBeforeSowing: 14,
        priority: "medium",
      },
    },
  ],
  totalCorrectionCost: 1000,
  maxDaysBeforeSowing: 14,
  hasCriticalGap: false,
};

const pestRisks: PestRisk[] = [
  {
    id: "p1",
    cropId: "test",
    pestName: "Leaf Miner",
    pestEmoji: "🪲",
    riskLevel: "high",
    symptoms: "test",
    biologicalControl: "test",
    economicThreshold: "test",
  },
  {
    id: "p2",
    cropId: "test",
    pestName: "Aphid",
    pestEmoji: "🐛",
    riskLevel: "medium",
    symptoms: "test",
    biologicalControl: "test",
    economicThreshold: "test",
  },
];

describe("resolveSowingDate", () => {
  it("anchors to the 1st of the chosen month in the reference year when the month is still ahead", () => {
    const reference = new Date(2026, 2, 15); // March 15, 2026
    const date = resolveSowingDate({ ...profile, currentMonth: 6 }, reference); // June
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(5);
    expect(date.getDate()).toBe(1);
  });

  it("rolls to next year when the chosen month has already started", () => {
    const reference = new Date(2026, 7, 15); // August 15, 2026
    const date = resolveSowingDate({ ...profile, currentMonth: 6 }, reference); // June, already passed
    expect(date.getFullYear()).toBe(2027);
    expect(date.getMonth()).toBe(5);
  });
});

describe("buildCropCalendar", () => {
  const referenceDate = new Date(2026, 2, 1); // March 1, 2026

  it("produces prep days ending exactly at sowing and a growing season of durationDays", () => {
    const plan = buildCropCalendar({ profile, crop, recommendation, gapAnalysis, pestRisks, referenceDate });
    const prepDays = plan.days.filter((d) => d.dayIndex < 0);
    const growingDays = plan.days.filter((d) => d.dayIndex >= 0);

    expect(prepDays).toHaveLength(14);
    expect(growingDays).toHaveLength(crop.durationDays + 1);
    expect(plan.sowingDateIso).toBe(findCalendarDay(plan, plan.sowingDateIso)?.dateIso);
  });

  it("is deterministic for the same inputs", () => {
    const planA = buildCropCalendar({ profile, crop, recommendation, gapAnalysis, pestRisks, referenceDate });
    const planB = buildCropCalendar({ profile, crop, recommendation, gapAnalysis, pestRisks, referenceDate });
    expect(planA).toEqual(planB);
  });

  it("places the correction's start task exactly minimumDaysBeforeSowing before sowing", () => {
    const plan = buildCropCalendar({ profile, crop, recommendation, gapAnalysis, pestRisks, referenceDate });
    const startDay = plan.days.find((d) => d.dayIndex === -14);
    expect(startDay?.isMilestone).toBe(true);
    expect(startDay?.tasks[0]).toContain("Compost application");
  });

  it("marks the sowing day as a milestone with a sow task", () => {
    const plan = buildCropCalendar({ profile, crop, recommendation, gapAnalysis, pestRisks, referenceDate });
    const sowDay = plan.days.find((d) => d.dayIndex === 0);
    expect(sowDay?.isMilestone).toBe(true);
    expect(sowDay?.tasks[0]).toContain("Sow Test Crop");
    expect(sowDay?.phase).toBe("germination");
  });

  it("only surfaces pest risk during vegetative and flowering phases", () => {
    const plan = buildCropCalendar({ profile, crop, recommendation, gapAnalysis, pestRisks, referenceDate });
    const germinationDay = plan.days.find((d) => d.dayIndex === 1);
    const vegetativeDay = plan.days.find((d) => d.phase === "vegetative");
    const floweringDay = plan.days.find((d) => d.phase === "flowering");

    expect(germinationDay?.risks).toEqual([]);
    expect(vegetativeDay?.risks).toContain("Leaf Miner");
    expect(vegetativeDay?.risks).not.toContain("Aphid");
    expect(floweringDay?.risks).toContain("Leaf Miner");
    expect(floweringDay?.risks).toContain("Aphid");
  });

  it("marks the final day as the harvest window with a milestone", () => {
    const plan = buildCropCalendar({ profile, crop, recommendation, gapAnalysis, pestRisks, referenceDate });
    const harvestDay = plan.days.find((d) => d.dayIndex === crop.durationDays);
    expect(harvestDay?.phase).toBe("harvest-window");
    expect(harvestDay?.isMilestone).toBe(true);
    expect(harvestDay?.tasks[0]).toContain("harvest window");
    expect(plan.harvestDateIso).toBe(harvestDay?.dateIso);
  });

  it("never produces a task or risk not traceable to an input fact", () => {
    const plan = buildCropCalendar({ profile, crop, recommendation, gapAnalysis, pestRisks, referenceDate });
    const allRisks = plan.days.flatMap((d) => d.risks);
    for (const risk of allRisks) {
      expect(pestRisks.map((p) => p.pestName)).toContain(risk);
    }
  });
});
