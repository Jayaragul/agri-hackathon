/**
 * Firestore-backed store for the AI Agent Trace log's backend copy — see
 * `storage/agentTraceTypes.ts` for the shape and why. Every call `HarnessTelemetry` records on
 * the frontend gets a best-effort mirror here (see `src/services/ai/runtime/telemetryPersistence.ts`),
 * so a page reload — or a judge asking to see what an earlier session's AI actually did — doesn't
 * lose the trace the app's whole honesty story depends on.
 *
 * Also writes a raw-JSON archive copy to Cloud Storage when configured, under
 * `agent-traces/<sessionId>/<id>.json` — the same additive, best-effort pattern
 * `MarketplaceStore`'s `archiveWrite` uses for FarmConnect orders/listings: Firestore stays the
 * actual system of record this store reads from, the bucket copy is a raw export/audit trail on
 * top, written to the SAME `GCS_BUCKET_NAME` bucket `fileStore.ts#createFileBackend` already
 * resolves for session/soil-report data (a third path prefix, not a new bucket to configure).
 */

import type { DocumentBackend } from "../storage/documentStore";
import type { FileBackend } from "../storage/fileStore";
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
  constructor(
    private readonly documents: DocumentBackend,
    /** Optional raw-JSON archive (see `storage/fileStore.ts#createFileBackend`) — purely additive, never affects Firestore's status as the actual source of truth. */
    private readonly archive?: FileBackend
  ) {}

  /**
   * Best-effort archival copy under `agent-traces/<sessionId>/<id>.json` — logged, never thrown,
   * and never awaited by the caller's response path. Recording a trace must never fail (or even
   * slow down) because the archive bucket is unreachable; Firestore already IS the durable record
   * by the time this runs. Mirrors `MarketplaceStore.archiveWrite` exactly.
   */
  private archiveWrite(sessionId: string, id: string, record: unknown): void {
    if (!this.archive) return;
    const path = `agent-traces/${sessionId}/${id}.json`;
    this.archive.writeFile(path, Buffer.from(JSON.stringify(record, null, 2)), "application/json").catch((err) => {
      console.warn(`[AgentTraceStore] archive write failed for "${path}":`, err instanceof Error ? err.message : String(err));
    });
  }

  /** Best-effort: a malformed/oversized record is dropped (logged), never thrown — telemetry must never be able to break the AI call it's describing. */
  async recordTrace(input: Omit<AgentTraceRecord, "loggedAtIso">): Promise<void> {
    const parsed = AgentTraceRecordSchema.omit({ loggedAtIso: true }).safeParse(input);
    if (!parsed.success) {
      console.warn("[AgentTraceStore] Dropping malformed trace record:", parsed.error.message);
      return;
    }
    const record: AgentTraceRecord = { ...parsed.data, loggedAtIso: new Date().toISOString() };
    const id = uuid();
    await this.documents.set(AGENT_TRACES_COLLECTION, id, record);
    this.archiveWrite(record.sessionId, id, record);
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

/** Lazy singleton, same pattern as `services/marketplaceStore.ts`'s. `archive` is only read on the FIRST call — subsequent calls (e.g. from a second route) reuse the store the singleton already built. */
export function getAgentTraceStore(documents: DocumentBackend, archive?: FileBackend): AgentTraceStore {
  if (singleton === null) singleton = new AgentTraceStore(documents, archive);
  return singleton;
}

/** Test-only: drop state and force a fresh store on the next `getAgentTraceStore()` call. */
export function resetAgentTraceStore(): void {
  singleton = null;
}
