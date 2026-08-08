/**
 * Frontend client for the optional long-term memory layer (`server/src/services/memoryService.ts`,
 * backed by mem0). Distinct from `services/storage`'s per-thread chat history: this recalls
 * durable FACTS across every conversation a farmer has ever had with any agent, so a brand new
 * conversation can be personalised without replaying the whole history.
 *
 * Every function here is best-effort and NEVER throws — with no backend deployed, or no
 * `MEM0_API_KEY` configured on it, every call silently resolves to "nothing remembered," and
 * every agent that uses this must already read that as a normal, expected state (see
 * `answerFarmQuestionPrompt.ts`'s "informational only" framing) rather than a failure.
 */
import { getFarmerId } from "../identity/farmerIdentity";

// Direct `import.meta.env.KEY` access, not an aliased `const meta = import.meta; meta.env`
// indirection — see the comment on `resolveEnvSource` in `services/ai/runtime/harnessConfig.ts`
// for why the indirect form silently resolves to nothing under Vite's dev-mode client injection.
function readApiBase(): string {
  try {
    const raw = import.meta.env.VITE_API_BASE_URL;
    return typeof raw === "string" ? raw.trim().replace(/\/$/, "") : "";
  } catch {
    return "";
  }
}

/** Record one turn for long-term recall. Fire-and-forget from the caller's perspective. */
export async function recordMemory(role: "farmer" | "assistant", text: string): Promise<void> {
  if (!text?.trim()) return;
  try {
    await fetch(`${readApiBase()}/api/sessions/${getFarmerId()}/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, text }),
    });
  } catch {
    // Best-effort only — a farmer's answer must never wait on, or fail because of, memory writes.
  }
}

/** Recall the most relevant remembered facts for a query, most relevant first. Resolves `[]` on any failure. */
export async function recallMemories(query: string, limit = 5): Promise<string[]> {
  if (!query?.trim()) return [];
  try {
    const url = `${readApiBase()}/api/sessions/${getFarmerId()}/memory?query=${encodeURIComponent(query)}&limit=${limit}`;
    const response = await fetch(url);
    if (!response.ok) return [];
    const body = (await response.json()) as { memories?: unknown };
    return Array.isArray(body?.memories) ? body.memories.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
}
