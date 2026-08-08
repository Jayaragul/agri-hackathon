import { describe, it, expect } from "vitest";
import { buildCropCalendar, parseIsoDate } from "../engine/cropCalendarEngine";
import { buildProactiveAlerts, describeProactiveAlert } from "../engine/proactiveEngine";
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
  gaps: [],
  totalCorrectionCost: 0,
  maxDaysBeforeSowing: 0,
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
];

// Sowing lands on June 1, 2026 (currentMonth: 6, reference date still in March). Vegetative
// phase (and Leaf Miner's risk window) begins day 9 — see cropCalendarEngine.test.ts's identical
// phase-boundary math for durationDays: 100.
const referenceDate = new Date(2026, 2, 1);
const plan = buildCropCalendar({ profile, crop, recommendation, gapAnalysis, pestRisks, referenceDate });
const sowingDate = parseIsoDate(plan.sowingDateIso);

function dayOffset(days: number): Date {
  return new Date(sowingDate.getFullYear(), sowingDate.getMonth(), sowingDate.getDate() + days);
}

describe("buildProactiveAlerts", () => {
  it("returns nothing when the reference date falls outside the plan entirely", () => {
    expect(buildProactiveAlerts(plan, new Date(2020, 0, 1))).toEqual([]);
  });

  it("surfaces the sowing-day milestone on its own when no risk opens within the window yet", () => {
    const alerts = buildProactiveAlerts(plan, sowingDate);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "milestone", mode: "proactive", source: "engine", dayIndex: 0 });
    expect(alerts[0].detail).toContain("Sow Test Crop today.");
  });

  it("surfaces a milestone and a newly-opening risk together when both fall inside the look-ahead window", () => {
    const alerts = buildProactiveAlerts(plan, dayOffset(2)); // window covers day 2..9
    expect(alerts).toHaveLength(2);
    expect(alerts.map((a) => a.kind).sort()).toEqual(["alert", "milestone"]);
    const risk = alerts.find((a) => a.kind === "alert");
    expect(risk?.title).toBe("Leaf Miner risk window opening");
    expect(risk?.dayIndex).toBe(9);
  });

  it("never repeats a risk that already opened before the reference date", () => {
    const alerts = buildProactiveAlerts(plan, dayOffset(10)); // Leaf Miner already open since day 9
    expect(alerts).toEqual([]);
  });

  it("respects a shorter lookAheadDays window", () => {
    const alerts = buildProactiveAlerts(plan, dayOffset(2), { lookAheadDays: 3 }); // window covers day 2..5, before day 9
    expect(alerts).toEqual([]);
  });

  it("orders alerts by day, earliest first", () => {
    const alerts = buildProactiveAlerts(plan, dayOffset(2));
    const dayIndexes = alerts.map((a) => a.dayIndex);
    expect(dayIndexes).toEqual([...dayIndexes].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });
});

describe("describeProactiveAlert", () => {
  it("joins title and detail with an em dash when both are present", () => {
    const text = describeProactiveAlert({
      id: "x",
      createdAtIso: "2026-01-01",
      mode: "proactive",
      kind: "alert",
      source: "engine",
      title: "Aphid risk window opening",
      detail: "Watch for Aphid starting around 2026-07-07.",
    });
    expect(text).toBe("Aphid risk window opening — Watch for Aphid starting around 2026-07-07.");
  });

  it("falls back to the title alone when detail is empty", () => {
    const text = describeProactiveAlert({
      id: "x",
      createdAtIso: "2026-01-01",
      mode: "proactive",
      kind: "milestone",
      source: "engine",
      title: "Harvest Window",
      detail: "",
    });
    expect(text).toBe("Harvest Window");
  });
});
