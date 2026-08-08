/**
 * Public entry point for session persistence, mirroring `services/ai/index.ts`: a lazy
 * singleton, one place to resolve which backend is in play. `VITE_API_BASE_URL` unset/empty
 * means same-origin (`/api/...`) — the normal case for the single-container Cloud Run deploy
 * where the server serves both the built frontend and its own API. The app works identically
 * with no backend deployed at all: every call degrades to `localStorage`.
 */
import { getSessionId } from "../session/sessionId";
import { BackendSessionStorage } from "./BackendSessionStorage";
import type { SessionStoragePort } from "./types";

let cachedStorage: SessionStoragePort | null = null;

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

export function getSessionStorage(): SessionStoragePort {
  if (cachedStorage === null) {
    cachedStorage = new BackendSessionStorage(getSessionId(), readApiBase());
  }
  return cachedStorage;
}

export function resetSessionStorage(): void {
  cachedStorage = null;
}

export type { CalendarChatMessage, ChatMessage, SessionSnapshot, SessionStoragePort } from "./types";
export { LocalStorageBackend } from "./LocalStorageBackend";
export { BackendSessionStorage } from "./BackendSessionStorage";
