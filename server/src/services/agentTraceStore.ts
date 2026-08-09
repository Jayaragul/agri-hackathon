/**
 * Firestore-backed store for the AI Agent Trace log's backend copy — see
 * `storage/agentTraceTypes.ts` for the shape and why. Every call `HarnessTelemetry` records on
 * the frontend gets a best-effort mirror here (see `src/services/ai/runtime/telemetryPersistence.ts`),
 * so a page reload — or a judge asking to see what an earlier session's AI actually did — doesn't
 * lose the trace the app's whole honesty story depends on.
 */

import type { DocumentBackend } from "../storage/documentStore";
import { AGENT_TRACES_COLLECTION, AgentTraceRecordSchema, TRACE_QUERY_LIMIT, type AgentTraceRecord } from "../storage/agentTraceTypes";

function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // Fall through.
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class AgentTraceStore {
  constructor(private readonly documents: DocumentBackend) {}

  /** Best-effort: a malformed/oversized record is dropped (logged), never thrown — telemetry must never be able to break the AI call it's describing. */
  async recordTrace(input: Omit<AgentTraceRecord, "loggedAtIso">): Promise<void> {
    const parsed = AgentTraceRecordSchema.omit({ loggedAtIso: true }).safeParse(input);
    if (!parsed.success) {
      console.warn("[AgentTraceStore] Dropping malformed trace record:", parsed.error.message);
      return;
    }
    const record: AgentTraceRecord = { ...parsed.data, loggedAtIso: new Date().toISOString() };
    await this.documents.set(AGENT_TRACES_COLLECTION, uuid(), record);
  }

  /**
   * This session's traces, oldest first (matching `HarnessTelemetry.getRecords()`'s own order),
   * so the frontend can just prepend them ahead of whatever's accumulated live this page-load.
   * Fetches the newest `TRACE_QUERY_LIMIT` records globally then filters by session in-process —
   * same trade-off `marketplaceStore.ts#getOrdersForCrop` makes, avoiding a Firestore composite
   * index for an equality-filter-plus-orderBy query.
   */
  async getRecentTraces(sessionId: string): Promise<AgentTraceRecord[]> {
    const recent = await this.documents.list<AgentTraceRecord>(AGENT_TRACES_COLLECTION, {
      orderByField: "sequence",
      direction: "desc",
      limit: TRACE_QUERY_LIMIT,
    });
    return recent.filter((r) => r.sessionId === sessionId).reverse();
  }
}

let singleton: AgentTraceStore | null = null;

/** Lazy singleton, same pattern as `services/marketplaceStore.ts`'s. */
export function getAgentTraceStore(documents: DocumentBackend): AgentTraceStore {
  if (singleton === null) singleton = new AgentTraceStore(documents);
  return singleton;
}

/** Test-only: drop state and force a fresh store on the next `getAgentTraceStore()` call. */
export function resetAgentTraceStore(): void {
  singleton = null;
}
