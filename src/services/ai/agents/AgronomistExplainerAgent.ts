/**
 * Antigravity ADK Agronomist Explainer Agent.
 *
 * Dedicated agent responsible for translating multi-factor mathematical decision traces
 * into structured, empathetic, and scientifically grounded farmer advice.
 */

import { AntigravityAdkAgent } from "./AntigravityAdkAgent";
import type { ExplainRecommendationInput } from "../prompts/explainRecommendationPrompt";
import {
  EXPLAIN_RECOMMENDATION_SYSTEM_PROMPT,
  buildExplainRecommendationUserPrompt
} from "../prompts/explainRecommendationPrompt";
import type { ExplanationOutput } from "../contracts/aiSchemas";
import { ExplanationOutputSchema } from "../contracts/aiSchemas";
import type { PromptPayload } from "../contracts/aiTypes";

export class AgronomistExplainerAgent extends AntigravityAdkAgent<ExplainRecommendationInput, ExplanationOutput> {
  constructor() {
    super({
      name: "AgronomistExplainerAgent",
      role: "Senior Agricultural Extension Officer & Decision Explainer",
      instruction: EXPLAIN_RECOMMENDATION_SYSTEM_PROMPT,
      model: "gemini-3.6-flash"
    });
  }

  public buildPrompt(input: ExplainRecommendationInput): PromptPayload {
    return {
      system: this.instruction,
      user: buildExplainRecommendationUserPrompt(input)
    };
  }

  public parseOutput(rawText: string): ExplanationOutput {
    let clean = rawText.trim();
    // Strip markdown code fences if model returned ```json ... ```
    if (clean.startsWith("```")) {
      clean = clean.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    const parsed = JSON.parse(clean);
    return ExplanationOutputSchema.parse(parsed);
  }
}
