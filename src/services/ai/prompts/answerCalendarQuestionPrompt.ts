/**
 * Prompt builder for the `answer-calendar-question` task.
 *
 * The farmer is looking at one day of the deterministic cultivation calendar
 * (`src/engine/cropCalendarEngine.ts`) and typed a free-text question about it. The model's
 * only job is to answer using the facts already computed for that day — it must not invent a
 * fertiliser, a pesticide, a dose, or a date that is not present in the supplied day data.
 */
import type { PromptPayload } from "../contracts/aiTypes";
import type { CalendarDay } from "../../../engine/cropCalendarEngine";
import type { Crop } from "../../../domain/models/models";
import { sanitiseInline } from "./promptFormat";

export interface AnswerCalendarQuestionInput {
  crop: Crop;
  day: CalendarDay;
  question: string;
  /** Long-term facts recalled from mem0 across past conversations (see `services/memory/memoryClient.ts`). Tone/continuity only — never eligible for `citedFacts`, which stays day-data-only. Always `[]` when memory isn't configured. */
  memories?: string[];
}

export const ANSWER_CALENDAR_QUESTION_SYSTEM_PROMPT = `You are the calendar-question layer of Thulir, a crop decision-support app used by smallholder farmers in Tamil Nadu, India.

YOUR ROLE
You ANSWER a farmer's question about ONE SPECIFIC DAY of their cultivation calendar. A deterministic engine, not you, computed that day's growth phase, scheduled tasks and pest-risk flags. You explain those facts in plain language; you do not add to them.

THE LIST IS CLOSED
You may only state facts that appear in the "Day data" section below. If the farmer asks something this data does not cover (a fertiliser brand, an exact dose, a chemical name, a different day, weather, or anything else not listed), say plainly that this calendar does not cover it and suggest asking a local agriculture extension officer. Never invent a product name, a quantity, or a date.

"citedFacts" MUST be copied verbatim (word-for-word) from the Day data section — the phase label, a task string, or a risk string. Never paraphrase into citedFacts. If your answer used no fact from the day data (e.g. you had to say "not covered"), return an empty array.

MEMORY OF PAST CONVERSATIONS
You may be given "What we remember about this farmer" — facts from earlier conversations. This is for tone and continuity only (e.g. noticing a recurring issue) — it is NEVER eligible for "citedFacts", which stays day-data-only, and it never overrides "the list is closed" rule above.

HOW TO WRITE
Your reader is a smallholder farmer. Two or three short sentences. Plain language, no jargon.

OUTPUT FORMAT
Reply with exactly ONE JSON object and nothing else — no greeting, no markdown, no code fences:
{
  "answer": string,
  "citedFacts": string[]
}`;

function formatDaySection(day: CalendarDay): string {
  const lines = [
    `Date: ${day.dateIso}`,
    `Day offset from sowing: ${day.dayIndex}`,
    `Phase: ${day.phaseLabel}`,
    `Scheduled tasks: ${day.tasks.length > 0 ? day.tasks.join(" | ") : "none recorded"}`,
    `Pest risk flags: ${day.risks.length > 0 ? day.risks.join(", ") : "none recorded"}`,
  ];
  return lines.join("\n");
}

function formatMemories(memories: string[] | undefined): string {
  if (!memories || memories.length === 0) return "(nothing remembered yet)";
  return memories.map((m) => `- ${sanitiseInline(m, 300)}`).join("\n");
}

export function buildAnswerCalendarQuestionUserPrompt(input: AnswerCalendarQuestionInput): string {
  const cropName = sanitiseInline(input?.crop?.name) || "the crop";
  const question = sanitiseInline(input?.question, 400) || "(no question text)";

  return `Crop: ${cropName}

Day data (the closed set of facts you may reference):
${formatDaySection(input.day)}

What we remember about this farmer (tone/continuity only — never a citable fact):
${formatMemories(input.memories)}

Farmer's question: "${question}"

Answer using only the day data above. Reply with the JSON object only.`;
}

export function buildAnswerCalendarQuestionPrompt(input: AnswerCalendarQuestionInput): PromptPayload {
  return {
    system: ANSWER_CALENDAR_QUESTION_SYSTEM_PROMPT,
    user: buildAnswerCalendarQuestionUserPrompt(input),
  };
}
