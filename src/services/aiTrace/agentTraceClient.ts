/**
 * Frontend client for `server/src/routes/agentTraceRoutes.ts` — gives the AI Agent Trace log a
 * durable backend copy. Never throws and never blocks the AI call it's describing: both
 * functions swallow any failure, same silently-degrading posture as every other optional
 * integration in this app (`marketplaceClient.ts`, `weatherClient.ts`, etc.).
 */
import type { AiCallRecord } from "../ai/contracts/aiTypes";

function readApiBase(): string {
  try {
    const raw = import.meta.env.VITE_API_BASE_URL;
    return typeof raw === "string" ? raw.trim().replace(/\/$/, "") : "";
  } catch {
    return "";
  }
}

/** Fire-and-forget: mirrors one call record to the backend. Caller should `void` this — a farmer's own AI call is already complete by the time this runs. */
export async function sendTrace(sessionId: string, record: AiCallRecord): Promise<void> {
  try {
    await fetch(`${readApiBase()}/api/agent-traces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, ...record }),
    });
  } catch {
    // Best-effort only — the live in-memory trace panel already has this record.
  }
}

/** This session's trace history, oldest first, for hydrating `HarnessTelemetry` on load. Resolves to `[]` on any failure — a farmer's trace panel just starts empty instead of erroring. */
export async function fetchRecentTraces(sessionId: string): Promise<AiCallRecord[]> {
  try {
    const response = await fetch(`${readApiBase()}/api/agent-traces/${encodeURIComponent(sessionId)}`);
    if (!response.ok) return [];
    const body = (await response.json()) as { records?: AiCallRecord[] };
    return Array.isArray(body.records) ? body.records : [];
  } catch {
    return [];
  }
}
