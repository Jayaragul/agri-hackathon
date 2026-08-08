import { describe, it, expect, afterEach } from "vitest";
import {
  getTimelineEvents,
  getRecentTimelineEvents,
  logTimelineEvent,
  clearTimelineEvents,
} from "../services/timeline/farmTimeline";

describe("farmTimeline", () => {
  afterEach(() => {
    clearTimelineEvents();
    localStorage.clear();
  });

  it("returns an empty array before anything has been logged", () => {
    expect(getTimelineEvents()).toEqual([]);
  });

  it("logs an event and returns the stored (id-assigned, timestamped) copy", () => {
    const stored = logTimelineEvent({
      mode: "reactive",
      kind: "observation",
      source: "farmer",
      title: "Sprayed neem oil",
      detail: "Sprayed neem oil on the lower leaves this morning.",
    });
    expect(stored.id).toBeTruthy();
    expect(stored.createdAtIso).toBeTruthy();
    expect(getTimelineEvents()).toEqual([stored]);
  });

  it("orders events most-recently-logged first", () => {
    logTimelineEvent({ mode: "reactive", kind: "observation", source: "farmer", title: "First", detail: "First" });
    logTimelineEvent({ mode: "reactive", kind: "observation", source: "farmer", title: "Second", detail: "Second" });
    const events = getTimelineEvents();
    expect(events.map((e) => e.title)).toEqual(["Second", "First"]);
  });

  it("trims and caps title and detail length", () => {
    const stored = logTimelineEvent({
      mode: "reactive",
      kind: "observation",
      source: "farmer",
      title: `  ${"t".repeat(200)}  `,
      detail: `  ${"d".repeat(500)}  `,
    });
    expect(stored.title.length).toBe(120);
    expect(stored.detail.length).toBe(400);
    expect(stored.title.startsWith(" ")).toBe(false);
  });

  it("defaults cropId/dayIndex to null when not supplied", () => {
    const stored = logTimelineEvent({ mode: "reactive", kind: "observation", source: "farmer", title: "X", detail: "X" });
    expect(stored.cropId).toBeNull();
    expect(stored.dayIndex).toBeNull();
  });

  it("caps total stored events, dropping the oldest first", () => {
    for (let i = 0; i < 45; i += 1) {
      logTimelineEvent({ mode: "reactive", kind: "observation", source: "farmer", title: `Event ${i}`, detail: `Event ${i}` });
    }
    const events = getTimelineEvents();
    expect(events).toHaveLength(40);
    expect(events[0].title).toBe("Event 44"); // most recent
    expect(events[events.length - 1].title).toBe("Event 5"); // oldest surviving — events 0-4 dropped
  });

  it("getRecentTimelineEvents slices to the requested limit without mutating the underlying log", () => {
    logTimelineEvent({ mode: "reactive", kind: "observation", source: "farmer", title: "A", detail: "A" });
    logTimelineEvent({ mode: "reactive", kind: "observation", source: "farmer", title: "B", detail: "B" });
    logTimelineEvent({ mode: "reactive", kind: "observation", source: "farmer", title: "C", detail: "C" });
    expect(getRecentTimelineEvents(2).map((e) => e.title)).toEqual(["C", "B"]);
    expect(getTimelineEvents()).toHaveLength(3);
  });

  it("ignores corrupted localStorage content rather than throwing", () => {
    localStorage.setItem("krishi-mitra.timeline-events", "{not json");
    expect(getTimelineEvents()).toEqual([]);
  });

  it("ignores a non-array value in localStorage rather than throwing", () => {
    localStorage.setItem("krishi-mitra.timeline-events", JSON.stringify({ not: "an array" }));
    expect(getTimelineEvents()).toEqual([]);
  });

  it("filters out malformed entries mixed into an otherwise-valid stored array", () => {
    const valid = {
      id: "1",
      createdAtIso: "2026-01-01T00:00:00.000Z",
      mode: "reactive",
      kind: "observation",
      source: "farmer",
      title: "Valid",
      detail: "Valid",
    };
    localStorage.setItem("krishi-mitra.timeline-events", JSON.stringify([valid, { garbage: true }, null, "nope"]));
    expect(getTimelineEvents()).toEqual([valid]);
  });
});
