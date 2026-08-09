import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryDocumentBackend } from "../storage/documentStore";
import { MemoryFileBackend, type FileBackend } from "../storage/fileStore";
import { getAgentTraceStore, resetAgentTraceStore } from "./agentTraceStore";

function freshStore(archive?: FileBackend) {
  resetAgentTraceStore();
  return getAgentTraceStore(new MemoryDocumentBackend(), archive);
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

  describe("archive (GCS_BUCKET_NAME agent-traces/**)", () => {
    it("archives a recorded trace under agent-traces/<sessionId>/<id>.json", async () => {
      const archive = new MemoryFileBackend();
      const writeSpy = vi.spyOn(archive, "writeFile");
      const store = freshStore(archive);
      await store.recordTrace(baseRecord);

      expect(writeSpy).toHaveBeenCalledTimes(1);
      const [path, data, contentType] = writeSpy.mock.calls[0];
      expect(path).toMatch(/^agent-traces\/s1\/[^/]+\.json$/);
      expect(contentType).toBe("application/json");
      expect(JSON.parse(data.toString("utf8"))).toMatchObject({ sessionId: "s1", label: "Ask Advisor" });

      expect(await archive.readFile(path)).not.toBeNull();
    });

    it("never archives a malformed record — it's dropped before any write is attempted", async () => {
      const archive = new MemoryFileBackend();
      const writeSpy = vi.spyOn(archive, "writeFile");
      const store = freshStore(archive);
      await store.recordTrace({ ...baseRecord, sessionId: "" } as never);
      expect(writeSpy).not.toHaveBeenCalled();
    });

    it("an archive write failure never breaks recordTrace — best-effort, logged not thrown", async () => {
      const archive: FileBackend = {
        writeFile: vi.fn().mockRejectedValue(new Error("bucket unreachable")),
        readFile: vi.fn().mockResolvedValue(null),
      };
      const store = freshStore(archive);
      await expect(store.recordTrace(baseRecord)).resolves.toBeUndefined();
      expect(await store.getRecentTraces("s1")).toHaveLength(1);
    });

    it("works exactly as before with no archive configured at all", async () => {
      const store = freshStore(); // no archive arg
      await expect(store.recordTrace(baseRecord)).resolves.toBeUndefined();
      expect(await store.getRecentTraces("s1")).toHaveLength(1);
    });
  });
});
