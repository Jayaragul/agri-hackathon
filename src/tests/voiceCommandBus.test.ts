import { describe, it, expect, vi } from "vitest";
import { parseVoiceIntent, executeVoiceIntent, type VoiceCommandContext } from "../services/voice/VoiceCommandBus";
import { demoProfile } from "../data/sample/demoProfile";
import type { RecommendationResult } from "../domain/models/models";

function makeContext(overrides: Partial<VoiceCommandContext> = {}): VoiceCommandContext {
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

describe("parseVoiceIntent", () => {
  it("recognises the demo command", () => {
    expect(parseVoiceIntent("load the demo profile")).toEqual({ type: "load_demo" });
  });

  it("recognises stage navigation by keyword", () => {
    expect(parseVoiceIntent("show me the crop recommendations")).toEqual({
      type: "go_to_stage",
      stage: "recommendations",
      label: "crop recommendations",
    });
  });

  it("recognises the digital twin by any of its aliases", () => {
    expect(parseVoiceIntent("open my field monitor")).toMatchObject({ stage: "digital-twin" });
  });

  it("falls back to unrecognized for gibberish", () => {
    expect(parseVoiceIntent("purple elephant sandwich")).toEqual({
      type: "unrecognized",
      raw: "purple elephant sandwich",
    });
  });

  it("treats an empty transcript as unrecognized", () => {
    expect(parseVoiceIntent("   ")).toEqual({ type: "unrecognized", raw: "   " });
  });
});

describe("executeVoiceIntent", () => {
  it("loads the demo profile and moves on", () => {
    const ctx = makeContext();
    const reply = executeVoiceIntent({ type: "load_demo" }, ctx);
    expect(ctx.loadDemoProfile).toHaveBeenCalledOnce();
    expect(reply).toContain("demo");
  });

  it("blocks navigation past farm-profile without a profile loaded", () => {
    const ctx = makeContext({ profile: null });
    const reply = executeVoiceIntent(
      { type: "go_to_stage", stage: "recommendations", label: "crop recommendations" },
      ctx
    );
    expect(ctx.setStage).not.toHaveBeenCalled();
    expect(reply).toContain("farm profile");
  });

  it("allows navigation to digital-twin without a profile", () => {
    const ctx = makeContext({ profile: null });
    executeVoiceIntent({ type: "go_to_stage", stage: "digital-twin", label: "digital twin" }, ctx);
    expect(ctx.setStage).toHaveBeenCalledWith("digital-twin");
  });

  it("navigates once a profile exists", () => {
    const ctx = makeContext({ profile: demoProfile });
    const reply = executeVoiceIntent(
      { type: "go_to_stage", stage: "recommendations", label: "crop recommendations" },
      ctx
    );
    expect(ctx.setStage).toHaveBeenCalledWith("recommendations");
    expect(reply).toContain("crop recommendations");
  });

  it("reads back the top recommendation when one exists", () => {
    const result = {
      crop: { name: "Groundnut" },
      score: 91.4,
      confidence: "high",
    } as RecommendationResult;
    const ctx = makeContext({ recommendations: [result] });
    const reply = executeVoiceIntent({ type: "read_top_recommendation" }, ctx);
    expect(reply).toContain("Groundnut");
    expect(reply).toContain("91");
    expect(reply).toContain("high");
  });

  it("says there is nothing to read when there are no recommendations", () => {
    const ctx = makeContext({ recommendations: [] });
    const reply = executeVoiceIntent({ type: "read_top_recommendation" }, ctx);
    expect(reply).toContain("No recommendations yet");
  });

  it("goes back one stage", () => {
    const ctx = makeContext({ stage: "financials" });
    const reply = executeVoiceIntent({ type: "go_back" }, ctx);
    expect(ctx.setStage).toHaveBeenCalledWith("soil-corrections");
    expect(reply).toContain("back");
  });

  it("refuses to go back from the first stage", () => {
    const ctx = makeContext({ stage: "farm-profile" });
    const reply = executeVoiceIntent({ type: "go_back" }, ctx);
    expect(ctx.setStage).not.toHaveBeenCalled();
    expect(reply).toContain("first step");
  });

  it("gives a helpful reply for an unrecognized command", () => {
    const ctx = makeContext();
    const reply = executeVoiceIntent({ type: "unrecognized", raw: "asdf" }, ctx);
    expect(reply).toContain("didn't catch that");
  });
});
