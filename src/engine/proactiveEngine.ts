/**
 * Deterministic forward-looking ("proactive") alerts, derived entirely from the cultivation
 * calendar the engine already computed — milestones and newly-opening pest-risk windows inside
 * the next `lookAheadDays`. Nothing here is invented or AI-generated: every alert is copied from
 * a `CalendarDay` the engine already scored, per [[krishi-mitra-ai-boundary]]. This is what lets
 * Audio Mode say "heads up, aphid risk starts in 3 days" without any model ever guessing at it.
 *
 * Deliberately NOT persisted (contrast `services/timeline/farmTimeline.ts`, which stores
 * REACTIVE events): "today" moves every time this is called, so a stored proactive alert would
 * silently go stale. Call this fresh wherever a current view is needed.
 */
import { toIsoDate, type CropCalendarPlan } from "./cropCalendarEngine";
import type { FarmTimelineEvent } from "../domain/models/models";

const DEFAULT_LOOK_AHEAD_DAYS = 7;

export interface BuildProactiveAlertsOptions {
  lookAheadDays?: number;
}

/**
 * Milestones and newly-opening risks within the look-ahead window. A risk already flagged on or
 * before `referenceDate` is not repeated — only the day a risk window FIRST opens is surfaced,
 * so the same pest warning doesn't fire again every single day it remains active.
 */
export function buildProactiveAlerts(
  plan: CropCalendarPlan,
  referenceDate: Date,
  options: BuildProactiveAlertsOptions = {}
): FarmTimelineEvent[] {
  const lookAheadDays = Math.max(0, Math.floor(options.lookAheadDays ?? DEFAULT_LOOK_AHEAD_DAYS));
  const todayIso = toIsoDate(referenceDate);
  const todayIndex = plan.days.findIndex((d) => d.dateIso === todayIso);
  if (todayIndex === -1) return [];

  const seenRisks = new Set<string>();
  for (let i = 0; i < todayIndex; i += 1) {
    for (const risk of plan.days[i].risks) seenRisks.add(risk);
  }

  const alerts: FarmTimelineEvent[] = [];
  const windowDays = plan.days.slice(todayIndex, todayIndex + lookAheadDays + 1);

  for (const day of windowDays) {
    if (day.isMilestone && day.tasks.length > 0) {
      alerts.push({
        id: `proactive-milestone-${day.dateIso}`,
        createdAtIso: todayIso,
        mode: "proactive",
        kind: "milestone",
        source: "engine",
        title: day.phaseLabel,
        detail: day.tasks.join(" "),
        dayIndex: day.dayIndex,
      });
    }
    for (const risk of day.risks) {
      if (seenRisks.has(risk)) continue;
      seenRisks.add(risk);
      alerts.push({
        id: `proactive-risk-${day.dateIso}-${risk}`,
        createdAtIso: todayIso,
        mode: "proactive",
        kind: "alert",
        source: "engine",
        title: `${risk} risk window opening`,
        detail: `Watch for ${risk} starting around ${day.dateIso} (${day.phaseLabel}).`,
        dayIndex: day.dayIndex,
      });
    }
  }

  return alerts.sort((a, b) => (a.dayIndex ?? 0) - (b.dayIndex ?? 0));
}

/** Single-line rendering of one alert — used wherever a full object doesn't fit (Crop Doctor's context, the Audio Mode greeting). */
export function describeProactiveAlert(alert: FarmTimelineEvent): string {
  return alert.detail ? `${alert.title} — ${alert.detail}` : alert.title;
}
