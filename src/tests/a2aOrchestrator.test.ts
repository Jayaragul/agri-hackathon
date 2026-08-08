import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { A2AOrchestrator } from "../services/ai/a2a/registry";
import { zodToJsonSchema } from "../services/ai/a2a/zodToJsonSchema";
import { getA2AOrchestrator, resetA2AOrchestrator } from "../services/ai/a2a";
import type { A2AAgentRegistration } from "../services/ai/a2a/types";

function makeRegistration(overrides: Partial<A2AAgentRegistration["card"]> = {}): A2AAgentRegistration {
  return {
    card: {
      id: "test-agent",
      name: "Test Agent",
      role: "Tester",
      description: "A test agent.",
      model: "mock",
      boundary: "explains",
      capabilities: { streaming: false, pushNotifications: false, toolCalling: false },
      tools: [],
      skills: [
        {
          id: "test-skill",
          name: "Test skill",
          description: "Echoes input.",
          tags: ["test"],
          inputSchema: {},
          outputSchema: {},
        },
      ],
      ...overrides,
    },
    skills: [
      {
        id: "test-skill",
        name: "Test skill",
        description: "Echoes input.",
        tags: ["test"],
        inputSchema: {},
        outputSchema: {},
        run: async (input: unknown) => ({
          data: input,
          source: "local",
          latencyMs: 0,
          degraded: true,
          validationRepaired: false,
          notes: [],
        }),
      },
    ],
  };
}

describe("A2AOrchestrator", () => {
  it("discovers registered agent cards", () => {
    const orchestrator = new A2AOrchestrator();
    orchestrator.register(makeRegistration());
    expect(orchestrator.listAgentCards()).toHaveLength(1);
    expect(orchestrator.getAgentCard("test-agent")?.name).toBe("Test Agent");
  });

  it("dispatches to the agent owning a skill and logs the full lifecycle", async () => {
    const orchestrator = new A2AOrchestrator();
    orchestrator.register(makeRegistration());

    const outcome = await orchestrator.dispatch("test-skill", { hello: "world" });
    expect(outcome.data).toEqual({ hello: "world" });

    const log = orchestrator.listTaskLog();
    expect(log.map((e) => e.state)).toEqual(["submitted", "working", "completed"]);
    expect(log.every((e) => e.agentId === "test-agent" && e.skillId === "test-skill")).toBe(true);
  });

  it("throws and records a failure for an unknown skill", async () => {
    const orchestrator = new A2AOrchestrator();
    await expect(orchestrator.dispatch("nonexistent", {})).rejects.toThrow(/No agent registered/);
    expect(orchestrator.listTaskLog()[0].state).toBe("failed");
  });

  it("records a failure entry when a skill throws", async () => {
    const orchestrator = new A2AOrchestrator();
    orchestrator.register({
      ...makeRegistration(),
      skills: [
        {
          id: "test-skill",
          name: "Test skill",
          description: "Throws.",
          tags: [],
          inputSchema: {},
          outputSchema: {},
          run: async () => {
            throw new Error("boom");
          },
        },
      ],
    });

    await expect(orchestrator.dispatch("test-skill", {})).rejects.toThrow("boom");
    const log = orchestrator.listTaskLog();
    expect(log[log.length - 1].state).toBe("failed");
    expect(log[log.length - 1].errorMessage).toBe("boom");
  });
});

describe("zodToJsonSchema", () => {
  it("mirrors a nested object schema", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().optional(),
      tags: z.array(z.string()),
      status: z.enum(["a", "b"]),
      score: z.number().nullable(),
    });

    const json = zodToJsonSchema(schema);
    expect(json.type).toBe("object");
    expect(json.required).toEqual(["name", "tags", "status", "score"]);
    expect(json.properties?.tags).toEqual({ type: "array", items: { type: "string" } });
    expect(json.properties?.status).toEqual({ type: "string", enum: ["a", "b"] });
    expect(json.properties?.score).toEqual({ type: "number", nullable: true });
  });
});

describe("default orchestrator wiring", () => {
  beforeEach(() => {
    resetA2AOrchestrator();
  });

  it("registers all six production agents with real skills", () => {
    const orchestrator = getA2AOrchestrator();
    const ids = orchestrator.listAgentCards().map((c) => c.id).sort();
    expect(ids).toEqual([
      "agronomist-explainer",
      "calendar-query",
      "general-farm-advisor",
      "market-intelligence",
      "pest-diagnostician",
      "soil-report-extractor",
    ]);
  });

  it("dispatches explain-recommendation through the real harness fallback path", async () => {
    const orchestrator = getA2AOrchestrator();
    const outcome = await orchestrator.dispatch("explain-recommendation", {
      result: {
        crop: { name: "Groundnut", id: "c1" },
        score: 80,
        decisionStatus: "recommended",
        confidence: "high",
      },
      profile: { ph: 6.5, region: "Coimbatore" },
    });
    expect(outcome.data).toBeDefined();
    expect(["local", "gemini", "cache"]).toContain(outcome.source);
  });
});
