/**
 * Long-term farmer memory via mem0 (https://mem0.ai) — a semantic memory layer distinct from
 * `services/storage`'s chat-thread persistence. Chat threads keep the FULL transcript of one
 * conversation; mem0 extracts durable FACTS across every conversation a farmer has ever had
 * with any agent ("grows tomatoes on 2 acres in Coimbatore", "already tried neem oil for aphids
 * last season") so a NEW conversation can be personalised without re-reading the entire history.
 *
 * Same "resolve once, degrade gracefully, never throw" discipline as `bucketStore.ts` and
 * `geminiProxy.ts`: with no `MEM0_API_KEY`, every call is a safe no-op and the app is
 * unaffected — a farmer without configured memory just gets a slightly less personalised
 * answer, never a broken one.
 */
import { MemoryClient } from "mem0ai";
import { resolveMem0ApiKey } from "./env";

export type MemoryRole = "farmer" | "assistant";

export interface MemoryBackend {
  /** Record one turn of a conversation, scoped to this session id. Never throws. */
  record(sessionId: string, role: MemoryRole, text: string): Promise<void>;
  /** Recall the most relevant remembered facts for a query, most relevant first. Never throws — resolves `[]` on any failure. */
  recall(sessionId: string, query: string, limit?: number): Promise<string[]>;
}

const DEFAULT_RECALL_LIMIT = 5;
const AGENT_ID = "krishi-mitra";

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Used whenever mem0 isn't configured. Every farmer-facing feature must work identically without it. */
export class NullMemoryBackend implements MemoryBackend {
  async record(): Promise<void> {
    // No-op.
  }

  async recall(): Promise<string[]> {
    return [];
  }
}

export class Mem0MemoryBackend implements MemoryBackend {
  private readonly client: MemoryClient;

  constructor(apiKey: string) {
    this.client = new MemoryClient({ apiKey });
  }

  async record(sessionId: string, role: MemoryRole, text: string): Promise<void> {
    if (!text?.trim()) return;
    try {
      await this.client.add([{ role: role === "farmer" ? "user" : "assistant", content: text }], {
        userId: sessionId,
        agentId: AGENT_ID,
      });
    } catch (err) {
      console.error(`[memoryService] record failed for session "${sessionId}":`, describeError(err));
    }
  }

  async recall(sessionId: string, query: string, limit: number = DEFAULT_RECALL_LIMIT): Promise<string[]> {
    if (!query?.trim()) return [];
    try {
      const result = await this.client.search(query, {
        filters: { user_id: sessionId },
        topK: limit,
      });
      return (result?.results ?? [])
        .map((memory) => memory.memory ?? "")
        .filter((text) => text.trim().length > 0);
    } catch (err) {
      console.error(`[memoryService] recall failed for session "${sessionId}":`, describeError(err));
      return [];
    }
  }
}

let cachedBackend: MemoryBackend | null = null;

/** Resolved once per process, same pattern as `createStorageBackend()`. Never throws. */
export function getMemoryBackend(): MemoryBackend {
  if (cachedBackend === null) {
    const apiKey = resolveMem0ApiKey();
    if (!apiKey) {
      console.log("Memory: no MEM0_API_KEY set — long-term memory disabled (per-thread chat history still works)");
      cachedBackend = new NullMemoryBackend();
    } else {
      try {
        cachedBackend = new Mem0MemoryBackend(apiKey);
        console.log("Memory: mem0 configured");
      } catch (err) {
        console.log(`Memory: mem0 construction failed, falling back to no-op: ${describeError(err)}`);
        cachedBackend = new NullMemoryBackend();
      }
    }
  }
  return cachedBackend;
}

/** Test-only: forces the next `getMemoryBackend()` call to re-resolve. */
export function resetMemoryBackend(): void {
  cachedBackend = null;
}
