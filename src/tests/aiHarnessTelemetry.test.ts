import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { AiHarness } from "../services/ai/runtime/AiHarness";
import { HarnessTelemetry } from "../services/ai/runtime/HarnessTelemetry";
import { ResponseCache } from "../services/ai/runtime/ResponseCache";
import { MockTransport } from "../services/ai/transport/MockTransport";
import { loadHarnessConfig } from "../services/ai/runtime/harnessConfig";
import type { AiTaskDefinition, PromptPayload } from "../services/ai/contracts/aiTypes";

/**
 * Covers the harness's full request/response/tool-call/notes logging — the "every request,
 * every response, every tool call, every thinking step" contract — independent of any one
 * production task, so these assertions can't be confused by a specific prompt's wording.
 */

interface EchoInput {
  question: string;
  grounded?: boolean;
}

const EchoOutputSchema = z.object({ answer: z.string() });

function makeTask(overrides: Partial<AiTaskDefinition<EchoInput, { answer: string }>> = {}): AiTaskDefinition<
  EchoInput,
  { answer: string }
> {
  return {
    id: "explain-recommendation",
    label: "Echo test task",
    buildPrompt: (input: EchoInput): PromptPayload => ({
      system: "You are a test echo agent.",
      user: `Question: ${input.question}`,
      useSearchGrounding: input.grounded === true,
    }),
    schema: EchoOutputSchema,
    fallback: (input: EchoInput) => ({ answer: `local answer to: ${input.question}` }),
    cacheKey: (input: EchoInput) => `echo:${input.question}`,
    ...overrides,
  };
}

function makeHarness(transport: MockTransport | null, telemetry = new HarnessTelemetry()) {
  const config = loadHarnessConfig({ VITE_GEMINI_API_KEY: transport ? "test-key" : "" });
  const cache = new ResponseCache("test-ns", config.cacheTtlMs);
  const harness = new AiHarness(config, transport, cache, telemetry, { sleep: () => Promise.resolve() });
  return { harness, telemetry, cache };
}

describe("AiHarness telemetry — request/response/tool-call/notes logging", () => {
  it("logs the full request even when gated straight to the local fallback", async () => {
    const { harness, telemetry } = makeHarness(null); // no transport configured -> gated
    const outcome = await harness.run(makeTask(), { question: "what now" });

    expect(outcome.source).toBe("local");
    const [record] = telemetry.getRecords();
    expect(record.request?.system).toBe("You are a test echo agent.");
    expect(record.request?.user).toContain("what now");
    expect(record.response.parsedData).toEqual({ answer: "local answer to: what now" });
    expect(record.response.rawText).toBeUndefined(); // no live attempt was ever made
    expect(record.notes.length).toBeGreaterThan(0);
    expect(record.toolCalls).toEqual([]);
  });

  it("logs the raw response text and parsed data for a live success", async () => {
    const transport = new MockTransport([{ text: JSON.stringify({ answer: "live answer" }) }]);
    const { harness, telemetry } = makeHarness(transport);
    const outcome = await harness.run(makeTask(), { question: "live?" });

    expect(outcome.source).toBe("gemini");
    const [record] = telemetry.getRecords();
    expect(record.response.rawText).toBe(JSON.stringify({ answer: "live answer" }));
    expect(record.response.parsedData).toEqual({ answer: "live answer" });
    expect(record.request?.user).toContain("live?");
  });

  it("records a google_search tool call with grounding URLs when search grounding is used", async () => {
    const transport = new MockTransport([
      { text: JSON.stringify({ answer: "grounded answer" }), groundingUrls: ["https://example.com/a"] },
    ]);
    const { harness, telemetry } = makeHarness(transport);
    await harness.run(makeTask(), { question: "price?", grounded: true });

    const [record] = telemetry.getRecords();
    expect(record.toolCalls).toHaveLength(1);
    expect(record.toolCalls[0].name).toBe("google_search");
    expect(record.toolCalls[0].output).toEqual({ groundingUrls: ["https://example.com/a"] });
    expect(record.response.groundingUrls).toEqual(["https://example.com/a"]);
  });

  it("does not log a tool call for a non-grounded request", async () => {
    const transport = new MockTransport([{ text: JSON.stringify({ answer: "plain" }) }]);
    const { harness, telemetry } = makeHarness(transport);
    await harness.run(makeTask(), { question: "plain?" });

    expect(telemetry.getRecords()[0].toolCalls).toEqual([]);
  });

  it("captures every step of the reasoning trail: retry, repair, and final fallback reason", async () => {
    const transport = new MockTransport([
      { error: new Error("network error occurred") }, // message matched by classifyError's network-failure heuristic
      { text: "not json at all" }, // triggers the repair round
      { text: "still not json" }, // repair also fails
    ]);
    const { harness, telemetry } = makeHarness(transport);
    const outcome = await harness.run(makeTask(), { question: "flaky" });

    expect(outcome.source).toBe("local");
    const [record] = telemetry.getRecords();
    expect(record.notes.some((n) => n.includes("retrying"))).toBe(true);
    expect(record.notes.some((n) => n.includes("repair"))).toBe(true);
    expect(record.notes.some((n) => n.includes("unusable"))).toBe(true);
    expect(record.response.rawText).toBe("still not json");
  });

  it("logs a cache replay with its own request snapshot and no tool calls", async () => {
    const telemetry = new HarnessTelemetry();
    const transport = new MockTransport([{ text: JSON.stringify({ answer: "cached me" }) }]);
    const { harness } = makeHarness(transport, telemetry);

    await harness.run(makeTask(), { question: "cache test" });
    await harness.run(makeTask(), { question: "cache test" }); // second call should hit cache

    const records = telemetry.getRecords();
    expect(records).toHaveLength(2);
    expect(records[1].source).toBe("cache");
    expect(records[1].response.parsedData).toEqual({ answer: "cached me" });
    expect(records[1].toolCalls).toEqual([]);
  });
});
