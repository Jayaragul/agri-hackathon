/**
 * Anonymous per-device session id. This app has no login — persistence is scoped to "this
 * browser, on this device," identified by a UUID generated once and kept in `localStorage`.
 * If a real account system is added later, this is the seam to replace: everything downstream
 * (`services/storage`) only ever asks for "the current session id," never how it was derived.
 */

const SESSION_ID_KEY = "krishi-mitra.session-id";

function randomUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the manual generator below.
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let cachedSessionId: string | null = null;

/** Get (or lazily create) this device's session id. Never throws — falls back to a per-load id when `localStorage` is unavailable (private browsing, SSR). */
export function getSessionId(): string {
  if (cachedSessionId !== null) return cachedSessionId;
  try {
    const existing = localStorage.getItem(SESSION_ID_KEY);
    if (existing && existing.length > 0) {
      cachedSessionId = existing;
      return existing;
    }
    const created = randomUuid();
    localStorage.setItem(SESSION_ID_KEY, created);
    cachedSessionId = created;
    return created;
  } catch {
    cachedSessionId = randomUuid();
    return cachedSessionId;
  }
}
