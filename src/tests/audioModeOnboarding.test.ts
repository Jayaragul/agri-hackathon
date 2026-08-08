import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { parseVoiceIntent, executeVoiceIntent, type VoiceCommandContext } from "../services/voice/VoiceCommandBus";
import { getFarmerName, setFarmerName, getDeclaredSituation, setDeclaredSituation } from "../services/identity/farmerIdentity";
import { getLabReport, setLabReport, clearLabReport } from "../services/identity/labReport";
import { clearTimelineEvents } from "../services/timeline/farmTimeline";
import { useFarmStore } from "../state/farmStore";
import { getFarmContextSnapshot, summariseSituation, summariseSoilNumbers } from "../services/context/farmContext";
import { buildAnswerFarmQuestionUserPrompt } from "../services/ai/prompts/answerFarmQuestionPrompt";
import { transcribeAudio, synthesizeSpeech, getVoiceStatus, VoiceProxyError } from "../services/voice/sarvamClient";
import { demoProfile } from "../data/sample/demoProfile";
import type { Crop, FarmProfile, RecommendationResult, SoilGapAnalysisResult } from "../domain/models/models";

function makeVoiceContext(overrides: Partial<VoiceCommandContext> = {}): VoiceCommandContext {
  return {
    stage: "farm-profile",
    profile: null,
    selectedCrop: null,
    recommendations: [],
    loadDemoProfile: vi.fn(),
    setStage: vi.fn(),
    ...overrides,
  };
}

describe("VoiceCommandBus — audio-mode", () => {
  it("recognises audio mode by its aliases", () => {
    expect(parseVoiceIntent("switch to audio mode")).toEqual({
      type: "go_to_stage",
      stage: "audio-mode",
      label: "audio mode",
    });
  });

  it("allows navigation to audio-mode without a profile or crop", () => {
    const ctx = makeVoiceContext({ profile: null, selectedCrop: null });
    executeVoiceIntent({ type: "go_to_stage", stage: "audio-mode", label: "audio mode" }, ctx);
    expect(ctx.setStage).toHaveBeenCalledWith("audio-mode");
  });
});

describe("farmerIdentity", () => {
  afterEach(() => localStorage.clear());

  it("persists a set name to localStorage and returns it", () => {
    setFarmerName("Meena");
    expect(getFarmerName()).toBe("Meena");
    expect(localStorage.getItem("krishi-mitra.farmer-name")).toBe("Meena");
  });

  it("trims whitespace and clears on blank input", () => {
    setFarmerName("  Raja  ");
    expect(getFarmerName()).toBe("Raja");
    setFarmerName("   ");
    expect(getFarmerName()).toBeNull();
  });

  it("persists a declared situation, trimmed and capped in length", () => {
    setDeclaredSituation("  Growing groundnut near Coimbatore  ");
    expect(getDeclaredSituation()).toBe("Growing groundnut near Coimbatore");
    expect(localStorage.getItem("krishi-mitra.declared-situation")).toBe("Growing groundnut near Coimbatore");

    setDeclaredSituation("a".repeat(500));
    expect(getDeclaredSituation()?.length).toBe(300);
  });

  it("clears the declared situation on blank input", () => {
    setDeclaredSituation("Growing tomatoes");
    setDeclaredSituation("   ");
    expect(getDeclaredSituation()).toBeNull();
  });
});

describe("labReport (services/identity)", () => {
  afterEach(() => {
    clearLabReport();
    localStorage.clear();
  });

  it("returns null until a lab report has been captured", () => {
    expect(getLabReport()).toBeNull();
  });

  it("persists a recognised extraction to localStorage and returns it", () => {
    const extraction = {
      ph: 6.5,
      nitrogenKgPerAcre: 80,
      phosphorusKgPerAcre: 40,
      potassiumKgPerAcre: 40,
      documentRecognised: true,
      confidence: "high" as const,
      warnings: [],
    };
    setLabReport(extraction);
    expect(getLabReport()).toEqual(extraction);
    expect(JSON.parse(localStorage.getItem("krishi-mitra.lab-report") || "{}")).toEqual(extraction);
  });

  it("ignores corrupted localStorage content rather than throwing", () => {
    localStorage.setItem("krishi-mitra.lab-report", "{not json");
    expect(getLabReport()).toBeNull();
  });

  it("clears the stored lab report", () => {
    setLabReport({
      ph: 6.5,
      nitrogenKgPerAcre: 80,
      phosphorusKgPerAcre: 40,
      potassiumKgPerAcre: 40,
      documentRecognised: true,
      confidence: "high",
      warnings: [],
    });
    clearLabReport();
    expect(getLabReport()).toBeNull();
  });
});

describe("farmContext", () => {
  beforeEach(() => {
    useFarmStore.setState({
      farmerName: "Kumar",
      profile: demoProfile,
      selectedCrop: null,
      recommendations: [],
      declaredSituation: null,
      labReport: null,
      timelineEvents: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers(); // safety net in case the fake-timers test below throws before its own cleanup runs
    clearLabReport();
    clearTimelineEvents();
    localStorage.clear();
  });

  it("assembles a snapshot from the current store state", () => {
    const snapshot = getFarmContextSnapshot();
    expect(snapshot.farmerName).toBe("Kumar");
    expect(snapshot.profile).toBe(demoProfile);
    expect(snapshot.crop).toBeNull();
    expect(snapshot.topRecommendation).toBeNull();
    expect(snapshot.declaredSituation).toBeNull();
    expect(snapshot.recentEvents).toEqual([]);
    expect(snapshot.upcomingAlerts).toEqual([]);
    expect(snapshot.labReport).toBeNull();
  });

  it("carries the most recent timeline events through, capped and most-recent-first", () => {
    useFarmStore.getState().logTimelineEvent({ mode: "reactive", kind: "observation", source: "farmer", title: "First", detail: "First" });
    useFarmStore.getState().logTimelineEvent({ mode: "reactive", kind: "observation", source: "farmer", title: "Second", detail: "Second" });
    const snapshot = getFarmContextSnapshot();
    expect(snapshot.recentEvents.map((e) => e.title)).toEqual(["Second", "First"]);
  });

  it("surfaces a farmer-uploaded lab report independent of the wizard profile", () => {
    useFarmStore.setState({ profile: null });
    useFarmStore.getState().setLabReport({
      ph: 6.2,
      nitrogenKgPerAcre: 70,
      phosphorusKgPerAcre: 35,
      potassiumKgPerAcre: 45,
      documentRecognised: true,
      confidence: "medium",
      warnings: [],
    });
    const snapshot = getFarmContextSnapshot();
    expect(snapshot.labReport?.ph).toBe(6.2);
    const summary = summariseSituation(snapshot);
    expect(summary).toContain("lab report");
    expect(summary).toContain("pH 6.2");
  });

  it("summariseSoilNumbers prefers the wizard profile over an uploaded lab report", () => {
    useFarmStore.getState().setLabReport({
      ph: 9.9,
      nitrogenKgPerAcre: 1,
      phosphorusKgPerAcre: 1,
      potassiumKgPerAcre: 1,
      documentRecognised: true,
      confidence: "low",
      warnings: [],
    });
    const summary = summariseSoilNumbers(getFarmContextSnapshot());
    expect(summary).toContain(`pH ${demoProfile.ph}`);
    expect(summary).not.toContain("9.9");
  });

  it("computes no upcoming alerts when the selected crop has no matching recommendation", () => {
    const mismatchedCrop: Crop = {
      id: "mismatch",
      name: "Mismatched Crop",
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
    useFarmStore.setState({ selectedCrop: mismatchedCrop, recommendations: [] });
    expect(getFarmContextSnapshot().upcomingAlerts).toEqual([]);
  });

  it("computes real upcoming alerts once profile, crop, and a matching recommendation align", () => {
    // A profile inside the crop's ideal pH range with a zero-deficit recommendation guarantees
    // `analyzeSoilGaps` finds no gaps (`maxDaysBeforeSowing: 0`), so the plan's very first day is
    // sowing day itself — pinning "now" to that exact date removes any dependency on gap-analysis
    // internals or real-world "today" for this test's determinism.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 1)); // April 1, 2026 — matches sowing day below exactly

    const profile: FarmProfile = {
      ph: 6.5,
      nitrogenKgPerAcre: 100,
      phosphorusKgPerAcre: 100,
      potassiumKgPerAcre: 100,
      soilType: "Red Soil",
      region: "Coimbatore",
      acres: 1,
      currentMonth: 4, // sowing anchors to April 1, 2026 given "now" is already in April
    };
    const crop: Crop = {
      id: "quick-crop",
      name: "Quick Crop",
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
    useFarmStore.setState({ profile, selectedCrop: crop, recommendations: [recommendation] });

    const alerts = getFarmContextSnapshot().upcomingAlerts;
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]).toMatchObject({ mode: "proactive", source: "engine" });

    vi.useRealTimers();
  });

  it("summarises a situation string only from what is actually known", () => {
    const snapshot = getFarmContextSnapshot();
    const summary = summariseSituation(snapshot);
    expect(summary).toContain(demoProfile.region);
    expect(summary).not.toContain("undefined");
  });

  it("omits the situation summary entirely when nothing is known", () => {
    useFarmStore.setState({ farmerName: null, profile: null, selectedCrop: null, recommendations: [], declaredSituation: null });
    const summary = summariseSituation(getFarmContextSnapshot());
    expect(summary).toBeUndefined();
  });

  it("falls back to the farmer's declared situation when no profile or crop is known", () => {
    useFarmStore.setState({ farmerName: "Kumar", profile: null, selectedCrop: null, recommendations: [], declaredSituation: "Growing tomatoes in Salem" });
    const summary = summariseSituation(getFarmContextSnapshot());
    expect(summary).toBe("farmer says: Growing tomatoes in Salem");
  });

  it("prefers real profile/crop facts over the declared situation when both exist", () => {
    useFarmStore.setState({ farmerName: "Kumar", profile: demoProfile, selectedCrop: null, recommendations: [], declaredSituation: "Growing tomatoes in Salem" });
    const summary = summariseSituation(getFarmContextSnapshot());
    expect(summary).toContain(demoProfile.region);
    expect(summary).not.toContain("tomatoes");
  });
});

describe("answer-farm-question prompt — farmer name", () => {
  it("greets the farmer by name when supplied", () => {
    const prompt = buildAnswerFarmQuestionUserPrompt({
      question: "What should I plant?",
      profile: null,
      crop: null,
      topRecommendation: null,
      farmerName: "Lakshmi",
    });
    expect(prompt).toContain("Farmer's name: Lakshmi");
  });

  it("omits the name line entirely when no name is known", () => {
    const prompt = buildAnswerFarmQuestionUserPrompt({
      question: "What should I plant?",
      profile: null,
      crop: null,
      topRecommendation: null,
    });
    expect(prompt).not.toContain("Farmer's name:");
  });

  it("includes what the farmer has volunteered when no profile has been entered", () => {
    const prompt = buildAnswerFarmQuestionUserPrompt({
      question: "When should I water?",
      profile: null,
      crop: null,
      topRecommendation: null,
      declaredSituation: "I grow groundnut near Coimbatore on two acres",
    });
    expect(prompt).toContain("What the farmer has told us directly");
    expect(prompt).toContain("I grow groundnut near Coimbatore on two acres");
  });

  it("says nothing was volunteered yet when there is no declared situation", () => {
    const prompt = buildAnswerFarmQuestionUserPrompt({
      question: "When should I water?",
      profile: null,
      crop: null,
      topRecommendation: null,
    });
    expect(prompt).toContain("(nothing volunteered yet)");
  });
});

describe("answer-farm-question prompt — recent events & upcoming alerts", () => {
  it("lists recent farm events under their own labelled section", () => {
    const prompt = buildAnswerFarmQuestionUserPrompt({
      question: "What should I do next?",
      profile: null,
      crop: null,
      topRecommendation: null,
      recentEvents: ["Noticed yellowing leaves on the lower canopy"],
    });
    expect(prompt).toContain("Recent farm events");
    expect(prompt).toContain("Noticed yellowing leaves on the lower canopy");
  });

  it("lists upcoming predicted alerts under their own labelled section", () => {
    const prompt = buildAnswerFarmQuestionUserPrompt({
      question: "What should I watch for?",
      profile: null,
      crop: null,
      topRecommendation: null,
      upcomingAlerts: ["Aphid risk window opening — watch for aphids starting around 2026-07-07."],
    });
    expect(prompt).toContain("Upcoming predicted events");
    expect(prompt).toContain("Aphid risk window opening");
  });

  it("shows explicit empty-state text when neither is supplied", () => {
    const prompt = buildAnswerFarmQuestionUserPrompt({
      question: "What should I watch for?",
      profile: null,
      crop: null,
      topRecommendation: null,
    });
    expect(prompt).toContain("(nothing logged yet)");
    expect(prompt).toContain("(no calendar predictions available yet)");
  });
});

describe("answer-farm-question prompt — spoken style (Audio Mode)", () => {
  it("tells the model this is a voice turn when spokenStyle is true", () => {
    const prompt = buildAnswerFarmQuestionUserPrompt({
      question: "What should I do about aphids?",
      profile: null,
      crop: null,
      topRecommendation: null,
      spokenStyle: true,
    });
    expect(prompt).toContain("VOICE turn");
    expect(prompt).toContain("1-3 short sentences");
  });

  it("says nothing about voice turns when spokenStyle is omitted (typed Advisor)", () => {
    const prompt = buildAnswerFarmQuestionUserPrompt({
      question: "What should I do about aphids?",
      profile: null,
      crop: null,
      topRecommendation: null,
    });
    expect(prompt).not.toContain("VOICE turn");
  });
});

describe("sarvamClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("getVoiceStatus resolves not-configured on network failure without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(getVoiceStatus()).resolves.toEqual({ configured: false, languageCode: "ta-IN" });
  });

  it("getVoiceStatus reports the backend's configured state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ configured: true, languageCode: "ta-IN" }) })
    );
    await expect(getVoiceStatus()).resolves.toEqual({ configured: true, languageCode: "ta-IN" });
  });

  it("transcribeAudio throws a VoiceProxyError on failure rather than silently degrading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: "Sarvam is not configured." }) })
    );
    await expect(transcribeAudio("base64", "audio/webm")).rejects.toBeInstanceOf(VoiceProxyError);
  });

  it("transcribeAudio returns the transcript on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ transcript: "vanakkam" }) }));
    await expect(transcribeAudio("base64", "audio/webm")).resolves.toBe("vanakkam");
  });

  it("synthesizeSpeech returns a data URI on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ audio: { mimeType: "audio/wav", base64Data: "abc" } }) })
    );
    await expect(synthesizeSpeech("hello")).resolves.toBe("data:audio/wav;base64,abc");
  });

  it("synthesizeSpeech throws when the backend returns no audio", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await expect(synthesizeSpeech("hello")).rejects.toBeInstanceOf(VoiceProxyError);
  });
});
