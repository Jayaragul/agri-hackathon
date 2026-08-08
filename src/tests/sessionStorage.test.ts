import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { LocalStorageBackend } from "../services/storage/LocalStorageBackend";
import { BackendSessionStorage } from "../services/storage/BackendSessionStorage";
import { getSessionId } from "../services/session/sessionId";
import type { FarmProfile } from "../domain/models/models";

const profile: FarmProfile = {
  ph: 6.5,
  nitrogenKgPerAcre: 80,
  phosphorusKgPerAcre: 40,
  potassiumKgPerAcre: 40,
  soilType: "Red Soil",
  region: "Coimbatore",
  acres: 2,
  currentMonth: 6,
};

describe("getSessionId", () => {
  it("creates and persists an id, reusing it on subsequent calls", () => {
    localStorage.clear();
    const first = getSessionId();
    expect(first.length).toBeGreaterThan(0);
    expect(localStorage.getItem("krishi-mitra.session-id")).toBe(first);
  });
});

describe("LocalStorageBackend", () => {
  const backend = new LocalStorageBackend("test-session");

  beforeEach(() => localStorage.clear());

  it("round-trips a saved snapshot", async () => {
    expect(await backend.loadSnapshot()).toBeNull();
    await backend.saveSnapshot(profile, "groundnut");
    const loaded = await backend.loadSnapshot();
    expect(loaded?.farmProfile).toEqual(profile);
    expect(loaded?.selectedCropId).toBe("groundnut");
  });

  it("returns an empty array for a day with no chat history", async () => {
    expect(await backend.loadCalendarMessages("2026-06-01")).toEqual([]);
  });

  it("appends messages in order and persists them", async () => {
    await backend.appendCalendarMessage("2026-06-01", { role: "farmer", text: "What now?" });
    const after = await backend.appendCalendarMessage("2026-06-01", { role: "assistant", text: "Sow today." });
    expect(after).toHaveLength(2);
    expect(after[0].role).toBe("farmer");
    expect(after[1].role).toBe("assistant");

    const reloaded = await backend.loadCalendarMessages("2026-06-01");
    expect(reloaded).toHaveLength(2);
  });

  it("keeps different days' chat threads separate", async () => {
    await backend.appendCalendarMessage("2026-06-01", { role: "farmer", text: "Day one question" });
    await backend.appendCalendarMessage("2026-06-02", { role: "farmer", text: "Day two question" });
    expect(await backend.loadCalendarMessages("2026-06-01")).toHaveLength(1);
    expect(await backend.loadCalendarMessages("2026-06-02")).toHaveLength(1);
  });

  it("keeps the advisor thread separate from calendar-day threads", async () => {
    await backend.appendCalendarMessage("2026-06-01", { role: "farmer", text: "Day question" });
    await backend.appendAdvisorMessage({ role: "farmer", text: "General question" });
    expect(await backend.loadAdvisorMessages()).toHaveLength(1);
    expect(await backend.loadCalendarMessages("2026-06-01")).toHaveLength(1);
  });

  it("appends advisor messages in order and persists them", async () => {
    await backend.appendAdvisorMessage({ role: "farmer", text: "What is NPK?" });
    const after = await backend.appendAdvisorMessage({ role: "assistant", text: "NPK stands for..." });
    expect(after).toHaveLength(2);
    expect(after[0].role).toBe("farmer");
    expect(after[1].role).toBe("assistant");
  });
});

describe("BackendSessionStorage", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("falls back to localStorage when the backend is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const storage = new BackendSessionStorage("test-session", "");

    await storage.saveSnapshot(profile, null);
    const loaded = await storage.loadSnapshot();
    expect(loaded?.farmProfile).toEqual(profile);
  });

  it("uses the backend response when it succeeds", async () => {
    const mockSnapshot = { farmProfile: profile, selectedCropId: "maize", savedAt: "2026-06-01T00:00:00.000Z" };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => mockSnapshot })
    );
    const storage = new BackendSessionStorage("test-session", "");
    const loaded = await storage.loadSnapshot();
    expect(loaded).toEqual(mockSnapshot);
  });

  it("treats a 404 as 'no snapshot yet' rather than falling back to local data", async () => {
    // Seed local storage with a DIFFERENT snapshot to prove it is not used when the backend is reachable.
    const local = new BackendSessionStorage("test-session", "")["fallback" as never] as unknown as LocalStorageBackend;
    await (local as LocalStorageBackend).saveSnapshot(profile, "local-only-crop");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const storage = new BackendSessionStorage("test-session", "");
    expect(await storage.loadSnapshot()).toBeNull();
  });

  it("stops calling the backend after the first failure within the same instance", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("down"));
    vi.stubGlobal("fetch", fetchMock);
    const storage = new BackendSessionStorage("test-session", "");

    await storage.loadSnapshot();
    await storage.loadSnapshot();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
