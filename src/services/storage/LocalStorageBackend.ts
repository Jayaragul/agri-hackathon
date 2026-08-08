import type { FarmProfile } from "../../domain/models/models";
import type { ChatMessage, SessionSnapshot, SessionStoragePort } from "./types";

/** Pure browser-storage implementation — the safe baseline every session works with, backend or not. */
export class LocalStorageBackend implements SessionStoragePort {
  constructor(private readonly sessionId: string) {}

  private snapshotKey(): string {
    return `krishi-mitra.session.${this.sessionId}.snapshot`;
  }

  private calendarChatKey(dateIso: string): string {
    return `krishi-mitra.session.${this.sessionId}.calendar.${dateIso}.chat`;
  }

  private advisorChatKey(): string {
    return `krishi-mitra.session.${this.sessionId}.advisor.chat`;
  }

  private readThread(key: string): ChatMessage[] {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private appendToThread(key: string, message: Omit<ChatMessage, "timestamp">): ChatMessage[] {
    const updated = [...this.readThread(key), { ...message, timestamp: new Date().toISOString() }];
    try {
      localStorage.setItem(key, JSON.stringify(updated));
    } catch {
      // Storage unavailable or full — persistence is best-effort, never fatal.
    }
    return updated;
  }

  async saveSnapshot(profile: FarmProfile, selectedCropId: string | null): Promise<void> {
    try {
      const snapshot: SessionSnapshot = { farmProfile: profile, selectedCropId, savedAt: new Date().toISOString() };
      localStorage.setItem(this.snapshotKey(), JSON.stringify(snapshot));
    } catch {
      // Best-effort.
    }
  }

  async loadSnapshot(): Promise<SessionSnapshot | null> {
    try {
      const raw = localStorage.getItem(this.snapshotKey());
      if (!raw) return null;
      return JSON.parse(raw) as SessionSnapshot;
    } catch {
      return null;
    }
  }

  async appendCalendarMessage(dateIso: string, message: Omit<ChatMessage, "timestamp">): Promise<ChatMessage[]> {
    return this.appendToThread(this.calendarChatKey(dateIso), message);
  }

  async loadCalendarMessages(dateIso: string): Promise<ChatMessage[]> {
    return this.readThread(this.calendarChatKey(dateIso));
  }

  async appendAdvisorMessage(message: Omit<ChatMessage, "timestamp">): Promise<ChatMessage[]> {
    return this.appendToThread(this.advisorChatKey(), message);
  }

  async loadAdvisorMessages(): Promise<ChatMessage[]> {
    return this.readThread(this.advisorChatKey());
  }
}
