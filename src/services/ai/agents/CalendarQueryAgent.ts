/**
 * Antigravity ADK Calendar Query Agent.
 *
 * Answers a farmer's free-text question about one day of the deterministic cultivation
 * calendar, grounded strictly in that day's already-computed facts.
 */
import { AntigravityAdkAgent } from "./AntigravityAdkAgent";
import type { AnswerCalendarQuestionInput } from "../prompts/answerCalendarQuestionPrompt";
import {
  ANSWER_CALENDAR_QUESTION_SYSTEM_PROMPT,
  buildAnswerCalendarQuestionUserPrompt,
} from "../prompts/answerCalendarQuestionPrompt";
import type { CalendarAnswer } from "../contracts/aiSchemas";
import { CalendarAnswerSchema } from "../contracts/aiSchemas";
import type { PromptPayload } from "../contracts/aiTypes";

export class CalendarQueryAgent extends AntigravityAdkAgent<AnswerCalendarQuestionInput, CalendarAnswer> {
  constructor() {
    super({
      name: "CalendarQueryAgent",
      role: "Field Extension Officer for Day-Specific Calendar Questions",
      instruction: ANSWER_CALENDAR_QUESTION_SYSTEM_PROMPT,
      model: "gemini-3.6-flash",
      temperature: 0.2,
    });
  }

  public buildPrompt(input: AnswerCalendarQuestionInput): PromptPayload {
    return {
      system: this.instruction,
      user: buildAnswerCalendarQuestionUserPrompt(input),
    };
  }

  public parseOutput(rawText: string): CalendarAnswer {
    let clean = rawText.trim();
    if (clean.startsWith("```")) {
      clean = clean.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    const parsed = JSON.parse(clean);
    return CalendarAnswerSchema.parse(parsed);
  }
}
