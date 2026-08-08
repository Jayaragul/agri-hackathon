/**
 * Task definition: `answer-farm-question`.
 *
 * The General Farm Advisor's live path. The fallback is not a stub: it calls
 * `buildLocalFarmAnswer`, the same deterministic, knowledge-base-grounded answer the app gives
 * with no API key at all — so a live model call only ever upgrades the wording/personalisation,
 * never unlocks the feature itself.
 */
import type { AiTaskDefinition } from "../contracts/aiTypes";
import { FarmAdvisorAnswerSchema, GEMINI_RESPONSE_SCHEMAS } from "../contracts/aiSchemas";
import type { FarmAdvisorAnswer } from "../contracts/aiSchemas";
import {
  buildAnswerFarmQuestionPrompt,
  type AnswerFarmQuestionInput,
} from "../prompts/answerFarmQuestionPrompt";
import { buildLocalFarmAnswer } from "../../advisor/farmKnowledgeBase";
import { stableHash } from "../prompts/promptFormat";

/** Create the answer-farm-question task. */
export function createAnswerFarmQuestionTask(): AiTaskDefinition<AnswerFarmQuestionInput, FarmAdvisorAnswer> {
  return {
    id: "answer-farm-question",
    label: "Answer farm advisor question",
    buildPrompt: buildAnswerFarmQuestionPrompt,
    schema: FarmAdvisorAnswerSchema,
    geminiResponseSchema: GEMINI_RESPONSE_SCHEMAS["answer-farm-question"],

    fallback(input: AnswerFarmQuestionInput): FarmAdvisorAnswer {
      return buildLocalFarmAnswer(input.question, input.profile, input.crop, input.topRecommendation);
    },

    /** Keyed on the question, the farm's identifying facts, the farmer's name, and whatever they've declared/logged/predicted, so two different farms (or two farmers, or two states of the same farm) never share a cached, mis-personalised answer. */
    cacheKey(input: AnswerFarmQuestionInput): string {
      const cropId = input.crop?.id ?? "no-crop";
      const region = (input.profile?.region ?? "no-profile").toLowerCase().trim();
      const farmerName = (input.farmerName ?? "no-name").toLowerCase().trim();
      const declared = stableHash(input.declaredSituation ?? "");
      const events = stableHash((input.recentEvents ?? []).join("|"));
      const alerts = stableHash((input.upcomingAlerts ?? []).join("|"));
      const toolResults = stableHash((input.liveToolResults ?? []).join("|"));
      const style = input.spokenStyle ? "voice" : "text";
      return `farm-q:${cropId}:${region}:${farmerName}:${declared}:${events}:${alerts}:${toolResults}:${style}:${stableHash(input.question)}`;
    },

    temperature: 0.2,
    timeoutMs: 20_000,
    cacheTtlMs: 24 * 60 * 60 * 1_000,
  };
}
