import { describe, it, expect, vi, afterEach } from "vitest";
import { createFarmAdvisorToolExecutor, FARM_ADVISOR_TOOL_NAMES } from "../services/ai/runtime/farmAdvisorTools";
import type { Crop, FarmProfile, RecommendationResult } from "../domain/models/models";

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
  id: "test-crop",
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

const topRecommendation: RecommendationResult = {
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

describe("createFarmAdvisorToolExecutor", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("get_calendar_day: returns an error object when the calendar isn't available yet", async () => {
    const executor = createFarmAdvisorToolExecutor({ crop: null, profile: null, topRecommendation: null });
    const result = await executor(FARM_ADVISOR_TOOL_NAMES.calendarDay, { dayNumber: 0 });
    expect(result).toMatchObject({ error: expect.any(String) });
  });

  it("get_calendar_day: returns real day data (phase/tasks/risks) from the deterministic engine", async () => {
    const executor = createFarmAdvisorToolExecutor({ crop, profile, topRecommendation });
    const result = await executor(FARM_ADVISOR_TOOL_NAMES.calendarDay, { dayNumber: 0 });
    expect(result).toMatchObject({ dayIndex: 0 });
    expect(result).toHaveProperty("phase");
    expect(result).toHaveProperty("tasks");
  });

  it("get_calendar_day: returns an error for a day outside the calendar's range", async () => {
    const executor = createFarmAdvisorToolExecutor({ crop, profile, topRecommendation });
    const result = await executor(FARM_ADVISOR_TOOL_NAMES.calendarDay, { dayNumber: 999999 });
    expect(result).toMatchObject({ error: expect.stringContaining("outside") });
  });

  it("get_weather_alerts: returns an error when no region is known", async () => {
    const executor = createFarmAdvisorToolExecutor({ crop: null, profile: null, topRecommendation: null });
    const result = await executor(FARM_ADVISOR_TOOL_NAMES.weatherAlerts, {});
    expect(result).toMatchObject({ error: expect.any(String) });
  });

  it("get_weather_alerts: degrades to an empty alert list rather than throwing when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const executor = createFarmAdvisorToolExecutor({ crop, profile, topRecommendation });
    const result = await executor(FARM_ADVISOR_TOOL_NAMES.weatherAlerts, {});
    expect(result).toEqual({ alerts: [] });
  });

  it("recall_more_memories: requires a query", async () => {
    const executor = createFarmAdvisorToolExecutor({ crop: null, profile: null, topRecommendation: null });
    const result = await executor(FARM_ADVISOR_TOOL_NAMES.recallMemories, {});
    expect(result).toMatchObject({ error: expect.any(String) });
  });

  it("recall_more_memories: returns memories from the memory client", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ memories: ["grows groundnut"] }) })
    );
    const executor = createFarmAdvisorToolExecutor({ crop: null, profile: null, topRecommendation: null });
    const result = await executor(FARM_ADVISOR_TOOL_NAMES.recallMemories, { query: "what crop" });
    expect(result).toEqual({ memories: ["grows groundnut"] });
  });

  it("get_live_market_price: returns an error when no crop is selected", async () => {
    const executor = createFarmAdvisorToolExecutor({ crop: null, profile: null, topRecommendation: null });
    const result = await executor(FARM_ADVISOR_TOOL_NAMES.marketPrice, {});
    expect(result).toMatchObject({ error: expect.any(String) });
  });

  it("returns an error object for an unknown tool name rather than throwing", async () => {
    const executor = createFarmAdvisorToolExecutor({ crop: null, profile: null, topRecommendation: null });
    const result = await executor("not_a_real_tool", {});
    expect(result).toMatchObject({ error: expect.stringContaining("Unknown tool") });
  });
});
