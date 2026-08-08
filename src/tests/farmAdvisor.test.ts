import { describe, it, expect } from "vitest";
import { buildLocalFarmAnswer, findKnowledgeEntries, summariseFarmContext } from "../services/advisor/farmKnowledgeBase";
import { demoProfile } from "../data/sample/demoProfile";
import { sampleCrops } from "../data/sample/crops";

describe("findKnowledgeEntries", () => {
  it("matches a question about NPK to the relevant entry", () => {
    const matches = findKnowledgeEntries("What is NPK and why does it matter for my crop?");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].id).toBe("what_is_npk");
  });

  it("returns nothing for a question with no keyword overlap", () => {
    expect(findKnowledgeEntries("asdf qwer zxcv")).toEqual([]);
  });

  it("respects the limit", () => {
    const matches = findKnowledgeEntries("soil pH nitrogen phosphorus potassium fertilizer pest irrigation", 1);
    expect(matches.length).toBeLessThanOrEqual(1);
  });
});

describe("summariseFarmContext", () => {
  it("says no profile yet when none is supplied", () => {
    expect(summariseFarmContext(null, null, null)).toContain("No farm profile");
  });

  it("includes crop and profile facts when supplied", () => {
    const crop = sampleCrops[0];
    const summary = summariseFarmContext(demoProfile, crop, null);
    expect(summary).toContain(demoProfile.region);
    expect(summary).toContain(crop.name);
  });
});

describe("buildLocalFarmAnswer", () => {
  it("gives a low-confidence honest answer when nothing matches", () => {
    const reply = buildLocalFarmAnswer("asdf qwer zxcv nonsense", null, null, null);
    expect(reply.confidence).toBe("low");
    expect(reply.answer).toContain("could not find");
  });

  it("answers from the knowledge base and cites the matched question as a topic", () => {
    const reply = buildLocalFarmAnswer("What is NPK?", null, null, null);
    expect(reply.topics.length).toBeGreaterThan(0);
    expect(reply.answer).toContain("NPK");
  });

  it("personalises the answer when a profile and crop are supplied", () => {
    const crop = sampleCrops[0];
    const reply = buildLocalFarmAnswer("What is NPK?", demoProfile, crop, null);
    expect(reply.answer).toContain(crop.name);
  });

  it("never invents anything beyond the knowledge base text and the supplied context", () => {
    const reply = buildLocalFarmAnswer("What is NPK?", demoProfile, null, null);
    expect(reply.answer).toContain(demoProfile.soilType);
  });
});
