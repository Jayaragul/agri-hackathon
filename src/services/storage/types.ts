/**
 * Shapes persisted by `services/storage`. Mirrors the API contract implemented by `server/`
 * (see `server/src/routes/sessionRoutes.ts`) — keep the two in sync by hand, since the server
 * deliberately does not import frontend source (the two halves deploy independently).
 */
import type { FarmProfile } from "../../domain/models/models";

export interface SessionSnapshot {
  farmProfile: FarmProfile;
  selectedCropId: string | null;
  savedAt: string;
}

/** One turn in a persisted chat thread — used for both the per-day calendar chat and the general advisor's ongoing thread. */
export interface ChatMessage {
  role: "farmer" | "assistant";
  text: string;
  citedFacts?: string[];
  source?: string;
  timestamp: string;
}

/** @deprecated Kept as an alias so existing imports (`CropCalendar.tsx`) keep working — the type is now general-purpose. Prefer `ChatMessage`. */
export type CalendarChatMessage = ChatMessage;

/**
 * The one seam every persistence backend implements. Mirrors `AiTransport` /
 * `VoiceAgentPort`: a single interface, swappable implementations, and a contract that never
 * rejects into UI code — every method resolves to a safe default (`null`, `[]`) on failure
 * rather than throwing, per [[krishi-mitra-ai-boundary]]'s broader "optional infrastructure"
 * philosophy applied to storage instead of AI.
 */
export interface SessionStoragePort {
  saveSnapshot(profile: FarmProfile, selectedCropId: string | null): Promise<void>;
  loadSnapshot(): Promise<SessionSnapshot | null>;
  appendCalendarMessage(dateIso: string, message: Omit<ChatMessage, "timestamp">): Promise<ChatMessage[]>;
  loadCalendarMessages(dateIso: string): Promise<ChatMessage[]>;
  /** The General Farm Advisor's single ongoing thread for this session (not scoped to a day). */
  appendAdvisorMessage(message: Omit<ChatMessage, "timestamp">): Promise<ChatMessage[]>;
  loadAdvisorMessages(): Promise<ChatMessage[]>;
}
