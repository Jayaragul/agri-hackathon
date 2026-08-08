import { describe, it, expect, vi, afterEach } from "vitest";
import { buildAnswerFarmQuestionUserPrompt } from "../services/ai/prompts/answerFarmQuestionPrompt";
import { buildAnswerCalendarQuestionUserPrompt } from "../services/ai/prompts/answerCalendarQuestionPrompt";
import { recallMemories, recordMemory } from "../services/memory/memoryClient";
import { getFarmerId } from "../services/identity/farmerIdentity";
import { demoProfile } from "../data/sample/demoProfile";
import type { CalendarDay } from "../engine/cropCalendarEngine";

const day: CalendarDay = {
  dateIso: "2026-06-01",
  dayIndex: 0,
  phase: "germination",
  phaseLabel: "Germination",
  tasks: ["Sow Groundnut today."],
  risks: [],
  isMilestone: true,
};

describe("answer-farm-question prompt — memory section", () => {
  it("includes remembered facts when supplied", () => {
    const prompt = buildAnswerFarmQuestionUserPrompt({
      question: "What should I do next?",
      profile: demoProfile,
      crop: null,
      topRecommendation: null,
      memories: ["Grows groundnut on 2 acres in Coimbatore."],
    });
    expect(prompt).toContain("What we remember about this farmer");
    expect(prompt).toContain("Grows groundnut on 2 acres in Coimbatore.");
  });

  it("says nothing remembered yet when memories are absent", () => {
    const prompt = buildAnswerFarmQuestionUserPrompt({
      question: "What should I do next?",
      profile: null,
      crop: null,
      topRecommendation: null,
    });
    expect(prompt).toContain("nothing remembered yet");
  });
});

describe("answer-calendar-question prompt — memory section", () => {
  it("includes memories but keeps the day-data-only citation rule intact", () => {
    const prompt = buildAnswerCalendarQuestionUserPrompt({
      crop: { name: "Groundnut" } as never,
      day,
      question: "Same problem as last time?",
      memories: ["Had aphids on groundnut last season."],
    });
    expect(prompt).toContain("Had aphids on groundnut last season.");
    expect(prompt).toContain("never a citable fact");
  });
});

describe("memoryClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("recallMemories resolves an empty array on network failure without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(recallMemories("test query")).resolves.toEqual([]);
  });

  it("recallMemories returns only string entries from a successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ memories: ["fact one", 42, null, "fact two"] }) })
    );
    await expect(recallMemories("test query")).resolves.toEqual(["fact one", "fact two"]);
  });

  it("recordMemory never throws on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(recordMemory("farmer", "hello")).resolves.toBeUndefined();
  });

  it("recordMemory skips an empty message without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await recordMemory("farmer", "   ");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("scopes recall/record by the stable per-device farmer id, not a throwaway session id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ memories: [] }) });
    vi.stubGlobal("fetch", fetchMock);
    await recallMemories("test query");
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`/api/sessions/${getFarmerId()}/memory`);
  });
});
