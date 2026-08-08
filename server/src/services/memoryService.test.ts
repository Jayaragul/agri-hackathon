import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NullMemoryBackend, Mem0MemoryBackend, getMemoryBackend, resetMemoryBackend } from "./memoryService";

describe("NullMemoryBackend", () => {
  it("records nothing and recalls nothing, never throwing", async () => {
    const backend = new NullMemoryBackend();
    await expect(backend.record("s1", "farmer", "hello")).resolves.toBeUndefined();
    await expect(backend.recall("s1", "hello")).resolves.toEqual([]);
  });
});

describe("getMemoryBackend", () => {
  const originalKey = process.env.MEM0_API_KEY;

  beforeEach(() => {
    resetMemoryBackend();
    delete process.env.MEM0_API_KEY;
  });

  afterEach(() => {
    resetMemoryBackend();
    if (originalKey) process.env.MEM0_API_KEY = originalKey;
  });

  it("resolves to a NullMemoryBackend when MEM0_API_KEY is unset", () => {
    expect(getMemoryBackend()).toBeInstanceOf(NullMemoryBackend);
  });

  it("resolves to a Mem0MemoryBackend when MEM0_API_KEY is set", () => {
    process.env.MEM0_API_KEY = "test-key";
    resetMemoryBackend();
    expect(getMemoryBackend()).toBeInstanceOf(Mem0MemoryBackend);
  });

  it("caches the resolved backend across calls", () => {
    const first = getMemoryBackend();
    const second = getMemoryBackend();
    expect(first).toBe(second);
  });
});

describe("Mem0MemoryBackend", () => {
  it("never throws when the underlying client rejects on record", async () => {
    const backend = new Mem0MemoryBackend("test-key");
    // @ts-expect-error - reaching into the private client to simulate a network failure
    backend.client.add = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(backend.record("s1", "farmer", "hello")).resolves.toBeUndefined();
  });

  it("never throws and resolves an empty array when the underlying client rejects on recall", async () => {
    const backend = new Mem0MemoryBackend("test-key");
    // @ts-expect-error - reaching into the private client to simulate a network failure
    backend.client.search = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(backend.recall("s1", "query")).resolves.toEqual([]);
  });

  it("extracts memory text from a successful search", async () => {
    const backend = new Mem0MemoryBackend("test-key");
    // @ts-expect-error - reaching into the private client to stub a successful response
    backend.client.search = vi.fn().mockResolvedValue({
      results: [{ id: "m1", memory: "Grows tomatoes on 2 acres in Coimbatore." }, { id: "m2", memory: "" }],
    });
    const memories = await backend.recall("s1", "what does this farmer grow?");
    expect(memories).toEqual(["Grows tomatoes on 2 acres in Coimbatore."]);
  });

  it("skips recording an empty message", async () => {
    const backend = new Mem0MemoryBackend("test-key");
    const addSpy = vi.fn();
    // @ts-expect-error - reaching into the private client
    backend.client.add = addSpy;
    await backend.record("s1", "farmer", "   ");
    expect(addSpy).not.toHaveBeenCalled();
  });
});
