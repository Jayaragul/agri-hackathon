import { describe, expect, it, beforeEach, vi } from "vitest";
import { MemoryDocumentBackend } from "../storage/documentStore";
import { MemoryFileBackend, type FileBackend } from "../storage/fileStore";
import { getMarketplaceStore, resetMarketplaceStore } from "./marketplaceStore";

/** Fresh in-memory-backed store per test — exercises the exact same read/write paths a real Firestore backend would. */
function freshStore(archive?: FileBackend) {
  resetMarketplaceStore();
  return getMarketplaceStore(new MemoryDocumentBackend(), archive);
}

describe("MarketplaceStore", () => {
  beforeEach(() => resetMarketplaceStore());

  it("syncOrder is idempotent on externalId", async () => {
    const store = freshStore();
    const order = {
      externalId: "o1",
      productName: "Tomato",
      quantity: 2,
      unit: "kg",
      price: 30,
      requestedAt: Date.now(),
    };
    expect(await store.syncOrder(order)).toBe(true);
    expect(await store.syncOrder(order)).toBe(false);
    expect(await store.getOrdersForCrop("Tomato")).toHaveLength(1);
  });

  it("matches crop names fuzzily, case-insensitively, either direction", async () => {
    const store = freshStore();
    await store.syncOrder({ externalId: "o1", productName: "Drumstick Leaves", quantity: 1, unit: "bunch", price: null, requestedAt: Date.now() });
    expect(await store.getOrdersForCrop("drumstick")).toHaveLength(1);
    expect(await store.getOrdersForCrop("Onion")).toHaveLength(0);
  });

  it("publishListing counts distinct matching requesters", async () => {
    const store = freshStore();
    await store.syncOrder({ externalId: "o1", productName: "Onion", quantity: 5, unit: "kg", price: 25, requestedAt: Date.now(), consumerId: "c1" });
    await store.syncOrder({ externalId: "o2", productName: "Onion", quantity: 3, unit: "kg", price: 22, requestedAt: Date.now(), consumerId: "c1" });
    await store.syncOrder({ externalId: "o3", productName: "Onion", quantity: 2, unit: "kg", price: 28, requestedAt: Date.now(), consumerId: "c2" });

    const listing = await store.publishListing({ cropName: "Onion", quantity: 20, unit: "kg", price: 25 });
    expect(listing.matchedRequesterCount).toBe(2);
    expect(listing.id).toBeTruthy();
    expect(listing.createdAt).toBeGreaterThan(0);
  });

  it("getListingsSince returns only listings newer than the given timestamp, oldest first", async () => {
    const store = freshStore();
    const nowSpy = vi.spyOn(Date, "now");

    nowSpy.mockReturnValue(1_000);
    const first = await store.publishListing({ cropName: "A", quantity: 1, unit: "kg", price: 10 });
    const cutoff = first.createdAt;

    nowSpy.mockReturnValue(2_000);
    const second = await store.publishListing({ cropName: "B", quantity: 1, unit: "kg", price: 10 });

    const since = await store.getListingsSince(cutoff);
    expect(since.map((l) => l.id)).toEqual([second.id]);

    nowSpy.mockRestore();
  });

  it("resetMarketplaceStore gives a fresh, empty store backed by a new backend", async () => {
    const store = freshStore();
    await store.syncOrder({ externalId: "o1", productName: "Tomato", quantity: 1, unit: "kg", price: 10, requestedAt: Date.now() });
    const store2 = freshStore();
    expect(await store2.getOrdersForCrop("Tomato")).toHaveLength(0);
  });

  it("two concurrent syncs of the same externalId never both succeed (the race the old GCS-index design could lose)", async () => {
    const backend = new MemoryDocumentBackend();
    resetMarketplaceStore();
    const store = getMarketplaceStore(backend);
    const order = { externalId: "race-1", productName: "Tomato", quantity: 1, unit: "kg", price: 10, requestedAt: Date.now() };

    const [a, b] = await Promise.all([store.syncOrder(order), store.syncOrder(order)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await store.getOrdersForCrop("Tomato")).toHaveLength(1);
  });

  describe("archive (AGRIDB_BUCKET_NAME)", () => {
    it("archives a synced order under farmconnect/orders/<externalId>.json", async () => {
      const archive = new MemoryFileBackend();
      const store = freshStore(archive);
      const order = { externalId: "o1", productName: "Tomato", quantity: 2, unit: "kg", price: 30, requestedAt: Date.now() };

      await store.syncOrder(order);

      const raw = await archive.readFile("farmconnect/orders/o1.json");
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!.toString())).toMatchObject(order);
    });

    it("does not archive a duplicate sync of the same externalId (createIfAbsent already rejected it)", async () => {
      const archive = new MemoryFileBackend();
      const writeSpy = vi.spyOn(archive, "writeFile");
      const store = freshStore(archive);
      const order = { externalId: "o1", productName: "Tomato", quantity: 2, unit: "kg", price: 30, requestedAt: Date.now() };

      await store.syncOrder(order);
      await store.syncOrder(order);

      expect(writeSpy).toHaveBeenCalledTimes(1);
    });

    it("archives a published listing under farmconnect/listings/<id>.json", async () => {
      const archive = new MemoryFileBackend();
      const store = freshStore(archive);

      const listing = await store.publishListing({ cropName: "Onion", quantity: 20, unit: "kg", price: 25 });

      const raw = await archive.readFile(`farmconnect/listings/${listing.id}.json`);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!.toString())).toMatchObject({ cropName: "Onion", id: listing.id });
    });

    it("an archive write failure never breaks the caller's response (best-effort, logged not thrown)", async () => {
      const archive: FileBackend = {
        writeFile: vi.fn().mockRejectedValue(new Error("bucket unreachable")),
        readFile: vi.fn().mockResolvedValue(null),
      };
      const store = freshStore(archive);

      await expect(
        store.syncOrder({ externalId: "o1", productName: "Tomato", quantity: 1, unit: "kg", price: 10, requestedAt: Date.now() })
      ).resolves.toBe(true);
      await expect(store.publishListing({ cropName: "Onion", quantity: 1, unit: "kg", price: 10 })).resolves.toBeTruthy();
    });

    it("works exactly as before with no archive configured at all", async () => {
      const store = freshStore(); // no archive arg
      await expect(
        store.syncOrder({ externalId: "o1", productName: "Tomato", quantity: 1, unit: "kg", price: 10, requestedAt: Date.now() })
      ).resolves.toBe(true);
    });
  });
});
