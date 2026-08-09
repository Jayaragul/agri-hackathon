import { describe, expect, it, beforeEach } from "vitest";
import { MemoryFileBackend } from "../storage/fileStore";
import { COMMUNITY_FARMER_COUNT, COMMUNITY_NETWORK_ARCHIVE_PATH } from "../storage/communityTypes";
import { getCommunityNetwork, resetCommunityNetworkCache } from "./communityNetworkService";

describe("communityNetworkService", () => {
  beforeEach(() => resetCommunityNetworkCache());

  it("generates exactly 30 farmers", async () => {
    const network = await getCommunityNetwork(new MemoryFileBackend());
    expect(network.farmers).toHaveLength(COMMUNITY_FARMER_COUNT);
  });

  it("every farmer has a valid crop id and lat/lng near Coimbatore", async () => {
    const network = await getCommunityNetwork(new MemoryFileBackend());
    for (const farmer of network.farmers) {
      expect(farmer.cropId.length).toBeGreaterThan(0);
      expect(farmer.lat).toBeGreaterThan(10.5);
      expect(farmer.lat).toBeLessThan(11.5);
      expect(farmer.lng).toBeGreaterThan(76.5);
      expect(farmer.lng).toBeLessThan(77.5);
    }
  });

  it("is deterministic — same seed produces the same farmers every time", async () => {
    resetCommunityNetworkCache();
    const a = await getCommunityNetwork(new MemoryFileBackend());
    resetCommunityNetworkCache();
    const b = await getCommunityNetwork(new MemoryFileBackend());
    expect(a.farmers).toEqual(b.farmers);
  });

  it("persists to the archive backend on first generation", async () => {
    const archive = new MemoryFileBackend();
    await getCommunityNetwork(archive);
    const stored = await archive.readFile(COMMUNITY_NETWORK_ARCHIVE_PATH);
    expect(stored).not.toBeNull();
  });

  it("reads back the persisted network on a fresh cache instead of regenerating", async () => {
    const archive = new MemoryFileBackend();
    const first = await getCommunityNetwork(archive);
    resetCommunityNetworkCache();
    const second = await getCommunityNetwork(archive);
    expect(second).toEqual(first);
  });

  it("some farmers have an active pest report and some do not", async () => {
    const network = await getCommunityNetwork(new MemoryFileBackend());
    const withReport = network.farmers.filter((f) => f.activePestReport !== null);
    expect(withReport.length).toBeGreaterThan(0);
    expect(withReport.length).toBeLessThan(network.farmers.length);
  });

  it("never throws when the archive backend's writeFile fails — falls back to in-memory", async () => {
    const archive = {
      writeFile: async () => {
        throw new Error("bucket unreachable");
      },
      readFile: async () => null,
    };
    const network = await getCommunityNetwork(archive);
    expect(network.farmers).toHaveLength(COMMUNITY_FARMER_COUNT);
  });
});
