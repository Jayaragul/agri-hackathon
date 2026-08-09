/**
 * Wires `HarnessTelemetry` (deliberately dependency-free, see its own doc comment) to the
 * backend: hydrates it once from this session's history on startup, then mirrors every NEW
 * record it produces to the backend as it happens. Called once from `services/ai/index.ts`'s
 * `getAiTelemetry()` when the singleton is first created.
 *
 * Kept as a separate module rather than importing the network client into `HarnessTelemetry`
 * itself, so that class can stay exactly what its own doc comment promises: synchronous,
 * dependency-free, never throwing into the call it's describing.
 */
import { getSessionId } from "../../session/sessionId";
import { fetchRecentTraces, sendTrace } from "../../aiTrace/agentTraceClient";
import type { HarnessTelemetry } from "./HarnessTelemetry";

export async function wireTelemetryPersistence(telemetry: HarnessTelemetry): Promise<void> {
  try {
    const history = await fetchRecentTraces(getSessionId());
    if (history.length > 0) telemetry.hydrate(history);
  } catch {
    // Best-effort — the panel just starts from whatever this process records live.
  }

  // Baseline AFTER hydration (not before): a hydrated record's renumbered `sequence` must never
  // look "new" and get sent right back to the backend it just came from.
  let lastSyncedSequence = telemetry.getRecords().reduce((max, r) => Math.max(max, r.sequence), 0);

  telemetry.subscribe(() => {
    const records = telemetry.getRecords();
    const maxSequence = records.reduce((max, r) => Math.max(max, r.sequence), 0);

    // A `clear()` restarts numbering at 1 — if the log is now shorter/lower than our last known
    // high-water mark, treat it as a reset so post-clear records still get synced instead of
    // silently looking "already synced" against a stale baseline.
    if (maxSequence < lastSyncedSequence) lastSyncedSequence = 0;

    const fresh = records.filter((r) => r.sequence > lastSyncedSequence);
    if (fresh.length === 0) return;
    lastSyncedSequence = maxSequence;

    const sessionId = getSessionId();
    for (const record of fresh) {
      void sendTrace(sessionId, record);
    }
  });
}
