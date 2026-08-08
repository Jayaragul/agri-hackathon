/**
 * Antigravity ADK General Farm Advisor Agent.
 *
 * Open-ended farming Q&A (soil, crops, pests, irrigation, general practice), grounded in the
 * verified local knowledge base and personalised with the farmer's own profile when available.
 */
import { AntigravityAdkAgent } from "./AntigravityAdkAgent";
import type { AnswerFarmQuestionInput } from "../prompts/answerFarmQuestionPrompt";
import {
  ANSWER_FARM_QUESTION_SYSTEM_PROMPT,
  buildAnswerFarmQuestionUserPrompt,
} from "../prompts/answerFarmQuestionPrompt";
import type { FarmAdvisorAnswer } from "../contracts/aiSchemas";
import { FarmAdvisorAnswerSchema } from "../contracts/aiSchemas";
import type { PromptPayload } from "../contracts/aiTypes";

export class GeneralFarmAdvisorAgent extends AntigravityAdkAgent<AnswerFarmQuestionInput, FarmAdvisorAnswer> {
  constructor() {
    super({
      name: "GeneralFarmAdvisorAgent",
      role: "General Farming Q&A Advisor",
      instruction: ANSWER_FARM_QUESTION_SYSTEM_PROMPT,
      model: "gemini-3.6-flash",
      temperature: 0.2,
    });
  }

  public buildPrompt(input: AnswerFarmQuestionInput): PromptPayload {
    return {
      system: this.instruction,
      user: buildAnswerFarmQuestionUserPrompt(input),
    };
  }

  public parseOutput(rawText: string): FarmAdvisorAnswer {
    let clean = rawText.trim();
    if (clean.startsWith("```")) {
      clean = clean.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    const parsed = JSON.parse(clean);
    return FarmAdvisorAnswerSchema.parse(parsed);
  }
}
