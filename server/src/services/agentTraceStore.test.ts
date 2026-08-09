import { describe, expect, it, beforeEach } from "vitest";
import { MemoryDocumentBackend } from "../storage/documentStore";
import { getAgentTraceStore, resetAgentTraceStore } from "./agentTraceStore";

function freshStore() {
  resetAgentTraceStore();
  return getAgentTraceStore(new MemoryDocumentBackend());
}

const baseRecord = {
  sessionId: "s1",
  taskId: "answer-farm-question",
  label: "Ask Advisor",
  source: "gemini" as const,
  latencyMs: 420,
  degraded: false,
  validationRepaired: false,
  ok: true,
  attempts: 1,
  sequence: 1,
  notes: [],
  response: { parsedData: { answer: "hello" } },
  toolCalls: [],
};

describe("AgentTraceStore", () => {
  beforeEach(() => resetAgentTraceStore());

  it("records a valid trace and returns it for that session", async () => {
    const store = freshStore();
    await store.recordTrace(baseRecord);
    const traces = await store.getRecentTraces("s1");
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({ sessionId: "s1", label: "Ask Advisor" });
    expect(traces[0].loggedAtIso).toBeTruthy();
  });

  it("never throws on a malformed record — silently drops it", async () => {
    const store = freshStore();
    await expect(store.recordTrace({ ...baseRecord, sessionId: "" } as never)).resolves.toBeUndefined();
    expect(await store.getRecentTraces("s1")).toHaveLength(0);
  });

  it("scopes traces to the requesting session only", async () => {
    const store = freshStore();
    await store.recordTrace(baseRecord);
    await store.recordTrace({ ...baseRecord, sessionId: "s2", sequence: 1 });
    expect(await store.getRecentTraces("s1")).toHaveLength(1);
    expect(await store.getRecentTraces("s2")).toHaveLength(1);
    expect(await store.getRecentTraces("s3")).toHaveLength(0);
  });

  it("returns traces oldest-first regardless of write order", async () => {
    const store = freshStore();
    await store.recordTrace({ ...baseRecord, sequence: 2 });
    await store.recordTrace({ ...baseRecord, sequence: 1 });
    const traces = await store.getRecentTraces("s1");
    expect(traces.map((t) => t.sequence)).toEqual([1, 2]);
  });
});
