/**
 * Persisted log of REACTIVE farm timeline events — things the farmer or an agent observed as
 * they happened (contrast `engine/proactiveEngine.ts`, which computes PREDICTED events fresh on
 * every call and never persists them, since "today" moves). `localStorage`-scoped to this
 * device, same convention as `services/identity/farmerIdentity.ts`, which this mirrors.
 *
 * This is the "calendar that stores everything" read by every agent through
 * `services/context/farmContext.ts` — a pest confirmed in Crop Doctor becomes visible to the
 * General Farm Advisor's next answer, and vice versa, with no agent-to-agent call needed.
 */
import type { FarmEventKind, FarmEventMode, FarmEventSource, FarmTimelineEvent } from "../../domain/models/models";

const TIMELINE_KEY = "krishi-mitra.timeline-events";
const MAX_TIMELINE_EVENTS = 40;
const MAX_TITLE_CHARS = 120;
const MAX_DETAIL_CHARS = 400;

let cachedEvents: FarmTimelineEvent[] | undefined;

function generateEventId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the fallback id below.
  }
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isValidEvent(value: unknown): value is FarmTimelineEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.createdAtIso === "string" &&
    typeof v.mode === "string" &&
    typeof v.kind === "string" &&
    typeof v.source === "string" &&
    typeof v.title === "string" &&
    typeof v.detail === "string"
  );
}

/** Every stored reactive event, most recently logged first. Never throws. */
export function getTimelineEvents(): FarmTimelineEvent[] {
  if (cachedEvents !== undefined) return cachedEvents;
  try {
    const raw = localStorage.getItem(TIMELINE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cachedEvents = Array.isArray(parsed) ? parsed.filter(isValidEvent) : [];
  } catch {
    cachedEvents = [];
  }
  return cachedEvents;
}

export interface LogTimelineEventInput {
  mode: FarmEventMode;
  kind: FarmEventKind;
  source: FarmEventSource;
  title: string;
  detail: string;
  cropId?: string | null;
  dayIndex?: number | null;
}

/** Append one reactive event, capped to the most recent `MAX_TIMELINE_EVENTS`. Returns the stored (trimmed) event. */
export function logTimelineEvent(event: LogTimelineEventInput): FarmTimelineEvent {
  const stored: FarmTimelineEvent = {
    id: generateEventId(),
    createdAtIso: new Date().toISOString(),
    mode: event.mode,
    kind: event.kind,
    source: event.source,
    title: event.title.trim().slice(0, MAX_TITLE_CHARS),
    detail: event.detail.trim().slice(0, MAX_DETAIL_CHARS),
    cropId: event.cropId ?? null,
    dayIndex: event.dayIndex ?? null,
  };

  const next = [stored, ...getTimelineEvents()].slice(0, MAX_TIMELINE_EVENTS);
  cachedEvents = next;
  try {
    localStorage.setItem(TIMELINE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort only — the in-memory cache above still lets the current session work.
  }
  return stored;
}

/** Reactive events only, most recent first, capped to `limit` — the slice every prompt/context consumer actually wants. */
export function getRecentTimelineEvents(limit = 5): FarmTimelineEvent[] {
  return getTimelineEvents().slice(0, Math.max(0, limit));
}

/** Resets to "not yet read" (not merely `[]`) so the next `getTimelineEvents()` re-derives from storage — same "drop the cache, rebuild fresh" contract as `services/ai/index.ts`'s `resetAiSingletons()`. Tests rely on this to isolate cases. */
export function clearTimelineEvents(): void {
  cachedEvents = undefined;
  try {
    localStorage.removeItem(TIMELINE_KEY);
  } catch {
    // Best-effort only.
  }
}
