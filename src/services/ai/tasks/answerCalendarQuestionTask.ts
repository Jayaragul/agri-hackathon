/**
 * Task definition: `answer-calendar-question`.
 *
 * Answers a farmer's free-text question about one day of the deterministic cultivation
 * calendar. The fallback cannot address the literal question (that needs the model), so it
 * degrades honestly: it reads back exactly what the engine already knows about that day,
 * rather than pretending to answer something it can't.
 */
import type { AiTaskDefinition } from "../contracts/aiTypes";
import { CalendarAnswerSchema, GEMINI_RESPONSE_SCHEMAS } from "../contracts/aiSchemas";
import type { CalendarAnswer } from "../contracts/aiSchemas";
import {
  buildAnswerCalendarQuestionPrompt,
  type AnswerCalendarQuestionInput,
} from "../prompts/answerCalendarQuestionPrompt";
import { stableHash } from "../prompts/promptFormat";

/** The honest, question-agnostic answer used whenever the model is unavailable. */
export function createDeterministicDayAnswer(input: AnswerCalendarQuestionInput): CalendarAnswer {
  const { day, crop } = input;
  const taskList = day.tasks.length > 0 ? day.tasks.join(" ") : "No specific task is scheduled for this day.";
  const riskNote = day.risks.length > 0 ? ` Watch for: ${day.risks.join(", ")}.` : "";
  const citedFacts = [day.phaseLabel, ...day.tasks, ...day.risks];

  return {
    answer:
      `On ${day.dateIso} (day ${day.dayIndex} for your ${crop.name}), the calendar has this in the ${day.phaseLabel} stage. ` +
      `${taskList}${riskNote} For anything beyond this, ask your local agriculture extension officer.`,
    citedFacts,
  };
}

/** Create the answer-calendar-question task. */
export function createAnswerCalendarQuestionTask(): AiTaskDefinition<AnswerCalendarQuestionInput, CalendarAnswer> {
  return {
    id: "answer-calendar-question",
    label: "Answer calendar day question",
    buildPrompt: buildAnswerCalendarQuestionPrompt,
    schema: CalendarAnswerSchema,
    geminiResponseSchema: GEMINI_RESPONSE_SCHEMAS["answer-calendar-question"],

    fallback(input: AnswerCalendarQuestionInput): CalendarAnswer {
      return createDeterministicDayAnswer(input);
    },

    /** Keyed on the crop, the exact day, and the question text, so two different questions about the same day never share a cached answer. */
    cacheKey(input: AnswerCalendarQuestionInput): string {
      const cropId = input?.crop?.id ?? "unknown-crop";
      const dateIso = input?.day?.dateIso ?? "unknown-date";
      const question = typeof input?.question === "string" ? input.question : "";
      return `calendar-q:${cropId}:${dateIso}:${stableHash(question)}`;
    },

    temperature: 0.2,
    timeoutMs: 20_000,
    cacheTtlMs: 24 * 60 * 60 * 1_000,
  };
}
