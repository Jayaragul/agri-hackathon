/**
 * Talks to the optional `server/` API when one is deployed; falls back to `LocalStorageBackend`
 * for any call that fails (no backend deployed, network error, non-2xx, timeout). Mirrors
 * `AiHarness`'s "resolve once, degrade gracefully" shape: the first failure flips `backendDown`
 * for the rest of the page session so a missing backend costs one slow timeout, not one per
 * call. A fresh page load probes again — a backend that comes back later is used again.
 */
import type { FarmProfile } from "../../domain/models/models";
import type { ChatMessage, SessionSnapshot, SessionStoragePort } from "./types";
import { LocalStorageBackend } from "./LocalStorageBackend";

const REQUEST_TIMEOUT_MS = 4_000;

export class BackendSessionStorage implements SessionStoragePort {
  private backendDown = false;
  private readonly fallback: LocalStorageBackend;

  constructor(
    private readonly sessionId: string,
    private readonly apiBase: string
  ) {
    this.fallback = new LocalStorageBackend(sessionId);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T | null> {
    if (this.backendDown) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.apiBase}${path}`, { ...init, signal: controller.signal });
      if (res.status === 404) return null;
      if (!res.ok) {
        this.backendDown = true;
        return null;
      }
      if (res.status === 204) return undefined as unknown as T;
      return (await res.json()) as T;
    } catch {
      this.backendDown = true;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async saveSnapshot(profile: FarmProfile, selectedCropId: string | null): Promise<void> {
    const result = await this.request<void>(`/api/sessions/${this.sessionId}/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ farmProfile: profile, selectedCropId }),
    });
    if (this.backendDown || result === null) {
      await this.fallback.saveSnapshot(profile, selectedCropId);
    }
  }

  async loadSnapshot(): Promise<SessionSnapshot | null> {
    const result = await this.request<SessionSnapshot>(`/api/sessions/${this.sessionId}/profile`);
    if (result !== null) return result;
    // `null` means either "reachable but nothing saved yet" (404) or "unreachable" (backendDown
    // just got set) — only the second case should fall back to whatever's in local storage.
    return this.backendDown ? this.fallback.loadSnapshot() : null;
  }

  async appendCalendarMessage(dateIso: string, message: Omit<ChatMessage, "timestamp">): Promise<ChatMessage[]> {
    const result = await this.request<ChatMessage[]>(`/api/sessions/${this.sessionId}/calendar/${dateIso}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    if (result !== null) return result;
    return this.fallback.appendCalendarMessage(dateIso, message);
  }

  async loadCalendarMessages(dateIso: string): Promise<ChatMessage[]> {
    const result = await this.request<ChatMessage[]>(`/api/sessions/${this.sessionId}/calendar/${dateIso}/messages`);
    if (result !== null) return result;
    return this.backendDown ? this.fallback.loadCalendarMessages(dateIso) : [];
  }

  async appendAdvisorMessage(message: Omit<ChatMessage, "timestamp">): Promise<ChatMessage[]> {
    const result = await this.request<ChatMessage[]>(`/api/sessions/${this.sessionId}/advisor/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    if (result !== null) return result;
    return this.fallback.appendAdvisorMessage(message);
  }

  async loadAdvisorMessages(): Promise<ChatMessage[]> {
    const result = await this.request<ChatMessage[]>(`/api/sessions/${this.sessionId}/advisor/messages`);
    if (result !== null) return result;
    return this.backendDown ? this.fallback.loadAdvisorMessages() : [];
  }
}
