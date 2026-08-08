/**
 * Zod-validated shapes for everything this server persists.
 *
 * The server is a dumb, trusted store: it does NOT depend on the frontend's `FarmProfile` type
 * (`src/domain/models/models.ts`) so the two halves of the app stay independently deployable.
 * `farmProfile` is opaque (`z.record`) on purpose — the frontend validates its own shape before
 * ever sending it here; this is a hackathon demo persisting non-sensitive agronomic data, not a
 * re-validation layer or an auth boundary.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Session snapshot — sessions/{sessionId}/profile.json
// ---------------------------------------------------------------------------

export const SessionSnapshotSchema = z.object({
  sessionId: z.string(),
  farmProfile: z.record(z.unknown()),
  selectedCropId: z.string().nullable(),
  savedAt: z.string(),
});

export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;

/** Body accepted by `PUT /api/sessions/:sessionId/profile` — server fills in `sessionId`/`savedAt`. */
export const SessionSnapshotInputSchema = z.object({
  farmProfile: z.record(z.unknown()),
  selectedCropId: z.string().nullable().optional().default(null),
});

export type SessionSnapshotInput = z.infer<typeof SessionSnapshotInputSchema>;

// ---------------------------------------------------------------------------
// Calendar day chat thread — sessions/{sessionId}/calendar/{dateIso}/chat.json
// ---------------------------------------------------------------------------

export const ChatRoleSchema = z.enum(["farmer", "assistant"]);

export const ChatMessageSchema = z.object({
  role: ChatRoleSchema,
  text: z.string(),
  citedFacts: z.array(z.string()).optional(),
  source: z.string().optional(),
  timestamp: z.string(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatThreadSchema = z.array(ChatMessageSchema);

export type ChatThread = z.infer<typeof ChatThreadSchema>;

/** Body accepted by `POST /api/sessions/:sessionId/calendar/:dateIso/messages` — server stamps `timestamp`. */
export const ChatMessageInputSchema = z.object({
  role: ChatRoleSchema,
  text: z.string(),
  citedFacts: z.array(z.string()).optional(),
  source: z.string().optional(),
});

export type ChatMessageInput = z.infer<typeof ChatMessageInputSchema>;

// ---------------------------------------------------------------------------
// Bucket path builders — the single source of truth for on-disk/on-bucket layout.
// ---------------------------------------------------------------------------

export function profilePath(sessionId: string): string {
  return `sessions/${sessionId}/profile.json`;
}

export function calendarChatPath(sessionId: string, dateIso: string): string {
  return `sessions/${sessionId}/calendar/${dateIso}/chat.json`;
}

/** The General Farm Advisor's single ongoing thread for a session — not scoped to a day. */
export function advisorChatPath(sessionId: string): string {
  return `sessions/${sessionId}/advisor/chat.json`;
}
