import { describe, it, expect } from "vitest";
import { buildWeeklyPlan } from "../engine/reportEngine";
import type { CalendarDay } from "../engine/cropCalendarEngine";

function day(partial: Partial<CalendarDay> & Pick<CalendarDay, "dateIso" | "dayIndex">): CalendarDay {
  return {
    phase: "vegetative",
    phaseLabel: "Vegetative Growth",
    tasks: [],
    risks: [],
    isMilestone: false,
    ...partial,
  };
}

describe("buildWeeklyPlan", () => {
  it("returns an empty array for no days", () => {
    expect(buildWeeklyPlan([])).toEqual([]);
  });

  it("groups 7 consecutive days into a single week", () => {
    const days: CalendarDay[] = Array.from({ length: 7 }, (_, i) =>
      day({ dateIso: `2024-06-0${i + 1}`, dayIndex: i })
    );
    const weeks = buildWeeklyPlan(days);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].weekIndex).toBe(0);
    expect(weeks[0].startDateIso).toBe("2024-06-01");
    expect(weeks[0].endDateIso).toBe("2024-06-07");
  });

  it("splits an 8th day into a second week", () => {
    const days: CalendarDay[] = Array.from({ length: 8 }, (_, i) =>
      day({ dateIso: `2024-06-${String(i + 1).padStart(2, "0")}`, dayIndex: i })
    );
    const weeks = buildWeeklyPlan(days);
    expect(weeks).toHaveLength(2);
    expect(weeks[1].weekIndex).toBe(1);
    expect(weeks[1].startDateIso).toBe("2024-06-08");
    expect(weeks[1].endDateIso).toBe("2024-06-08");
  });

  it("anchors bucketing at the first (possibly negative) dayIndex, not at zero", () => {
    const days: CalendarDay[] = [
      day({ dateIso: "2024-05-29", dayIndex: -3 }),
      day({ dateIso: "2024-05-30", dayIndex: -2 }),
      day({ dateIso: "2024-05-31", dayIndex: -1 }),
      day({ dateIso: "2024-06-01", dayIndex: 0 }),
    ];
    const weeks = buildWeeklyPlan(days);
    // -3..0 spans 4 days from the anchor -3, all within one 7-day bucket.
    expect(weeks).toHaveLength(1);
    expect(weeks[0].startDateIso).toBe("2024-05-29");
    expect(weeks[0].endDateIso).toBe("2024-06-01");
  });

  it("dedupes tasks/risks across the week and counts milestones", () => {
    const days: CalendarDay[] = [
      day({ dateIso: "2024-06-01", dayIndex: 0, tasks: ["Sow crop."], isMilestone: true }),
      day({ dateIso: "2024-06-02", dayIndex: 1, tasks: ["Continue soil preparation."], risks: ["Aphid"] }),
      day({ dateIso: "2024-06-03", dayIndex: 2, risks: ["Aphid"] }),
    ];
    const weeks = buildWeeklyPlan(days);
    expect(weeks[0].goals).toEqual(["Sow crop.", "Continue soil preparation."]);
    expect(weeks[0].watchOuts).toEqual(["Aphid"]);
    expect(weeks[0].milestoneCount).toBe(1);
  });

  it("collects distinct phase labels in chronological order when a week straddles a phase change", () => {
    const days: CalendarDay[] = [
      day({ dateIso: "2024-06-01", dayIndex: 0, phase: "germination", phaseLabel: "Germination" }),
      day({ dateIso: "2024-06-02", dayIndex: 1, phase: "germination", phaseLabel: "Germination" }),
      day({ dateIso: "2024-06-03", dayIndex: 2, phase: "vegetative", phaseLabel: "Vegetative Growth" }),
    ];
    const weeks = buildWeeklyPlan(days);
    expect(weeks[0].phases).toEqual(["Germination", "Vegetative Growth"]);
  });
});
