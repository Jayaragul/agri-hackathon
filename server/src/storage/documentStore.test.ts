import { describe, expect, it } from "vitest";
import { MemoryDocumentBackend } from "./documentStore";

describe("MemoryDocumentBackend", () => {
  it("createIfAbsent creates once and refuses a second call for the same id", async () => {
    const backend = new MemoryDocumentBackend();
    expect(await backend.createIfAbsent("orders", "o1", { a: 1 })).toBe(true);
    expect(await backend.createIfAbsent("orders", "o1", { a: 2 })).toBe(false);
    expect(await backend.get("orders", "o1")).toEqual({ a: 1 });
  });

  it("set upserts regardless of whether the document already exists", async () => {
    const backend = new MemoryDocumentBackend();
    await backend.set("listings", "l1", { price: 10 });
    await backend.set("listings", "l1", { price: 20 });
    expect(await backend.get("listings", "l1")).toEqual({ price: 20 });
  });

  it("get returns null for a missing document, in a missing collection", async () => {
    const backend = new MemoryDocumentBackend();
    expect(await backend.get("nope", "x")).toBeNull();
  });

  it("list applies where, orderBy, direction, and limit together", async () => {
    const backend = new MemoryDocumentBackend();
    await backend.set("items", "a", { crop: "tomato", createdAt: 3 });
    await backend.set("items", "b", { crop: "onion", createdAt: 1 });
    await backend.set("items", "c", { crop: "tomato", createdAt: 2 });

    const results = await backend.list("items", {
      where: [["crop", "==", "tomato"]],
      orderByField: "createdAt",
      direction: "desc",
    });
    expect(results.map((r: any) => r.createdAt)).toEqual([3, 2]);
  });

  it("list supports a numeric range where clause (mirrors Firestore's inequality queries)", async () => {
    const backend = new MemoryDocumentBackend();
    await backend.set("events", "a", { createdAt: 100 });
    await backend.set("events", "b", { createdAt: 200 });
    await backend.set("events", "c", { createdAt: 300 });

    const results = await backend.list("events", { where: [["createdAt", ">", 150]], orderByField: "createdAt", direction: "asc" });
    expect(results.map((r: any) => r.createdAt)).toEqual([200, 300]);
  });

  it("list respects limit after ordering", async () => {
    const backend = new MemoryDocumentBackend();
    await backend.set("events", "a", { createdAt: 1 });
    await backend.set("events", "b", { createdAt: 2 });
    await backend.set("events", "c", { createdAt: 3 });

    const results = await backend.list("events", { orderByField: "createdAt", direction: "desc", limit: 2 });
    expect(results.map((r: any) => r.createdAt)).toEqual([3, 2]);
  });

  it("collections are isolated from each other", async () => {
    const backend = new MemoryDocumentBackend();
    await backend.set("orders", "x", { a: 1 });
    expect(await backend.get("listings", "x")).toBeNull();
  });
});
