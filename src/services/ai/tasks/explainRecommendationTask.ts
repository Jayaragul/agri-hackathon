/**
 * Task definition: `explain-recommendation`.
 *
 * Turns a `RecommendationResult` the engine has already produced into a farmer-readable
 * narrative. The model rewords; it never re-scores.
 *
 * The fallback is the interesting part. It is not a stub or an apology string: it calls the
 * existing `LocalTemplateExplanationProvider` - the same deterministic template that shipped
 * before any AI existed - and adapts its output into `ExplanationOutput`. So with no API key,
 * no network, or a failed model call, the farmer still gets the full explanation, only
 * flagged as `degraded` in the trace panel. That is what makes the AI layer genuinely
 * optional rather than load-bearing.
 */

import type { AiTaskDefinition } from "../contracts/aiTypes";
import { ExplanationOutputSchema, GEMINI_RESPONSE_SCHEMAS } from "../contracts/aiSchemas";
import type { ExplanationOutput } from "../contracts/aiSchemas";
import type { ExplanationProvider } from "../../../domain/models/models";
import {
  buildExplainRecommendationPrompt,
  type ExplainRecommendationInput,
} from "../prompts/explainRecommendationPrompt";
import { LocalTemplateExplanationProvider } from "../../explanation/LocalTemplateExplanationProvider";
import { formatNumber } from "../prompts/promptFormat";

/** Maximum entries the schema allows in each narrative array. */
const MAX_ITEMS = 6;

/** Prefixes emitted by `LocalTemplateExplanationProvider`, used to parse its output back. */
const MARKER_POSITIVE = "✅"; // ✅
const MARKER_RISK = "⚠️"; // ⚠️
const MARKER_BLOCKER = "❌"; // ❌
const MARKER_ACTION = "-";

/** One short sentence per engine `decisionStatus`, used to build the fallback headline. */
const STATUS_HEADLINE: Record<string, string> = {
  recommended: "is a good fit for your farm right now",
  "recommended-with-corrections": "can work on your farm once the soil is corrected",
  "high-risk": "carries real risk on your farm right now",
  "not-currently-feasible": "should not be sown on your farm right now",
};

/** Trim a list to the schema's cap and drop blank entries. */
function capList(values: string[]): string[] {
  const cleaned: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0 && cleaned.length < MAX_ITEMS) cleaned.push(trimmed);
  }
  return cleaned;
}

/**
 * Adapt the local provider's markdown-ish string into the structured `ExplanationOutput`.
 *
 * The local format is a flat line list with four possible line kinds - `**heading**`,
 * `✅ positive`, `⚠️ risk`, `❌ blocker`, and `- nutrient gap`. Blockers are folded into
 * `risks` (they are the most severe risks), and nutrient-gap lines become `nextActions`,
 * which is what they functionally are.
 */
export function adaptLocalExplanation(
  text: string,
  input: ExplainRecommendationInput
): ExplanationOutput {
  const whyThisCrop: string[] = [];
  const risks: string[] = [];
  const nextActions: string[] = [];

  const lines = typeof text === "string" ? text.split("\n") : [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith("**")) continue; // section heading, structure is rebuilt below
    if (line.startsWith(MARKER_POSITIVE)) {
      whyThisCrop.push(line.slice(MARKER_POSITIVE.length).trim());
    } else if (line.startsWith(MARKER_RISK)) {
      risks.push(line.slice(MARKER_RISK.length).trim());
    } else if (line.startsWith(MARKER_BLOCKER)) {
      risks.push(line.slice(MARKER_BLOCKER.length).trim());
    } else if (line.startsWith(MARKER_ACTION)) {
      nextActions.push(`${line.slice(1).trim()} - correct this before sowing.`);
    } else {
      whyThisCrop.push(line);
    }
  }

  const cropName = input?.result?.crop?.name ?? "This crop";
  const status = input?.result?.decisionStatus ?? "";
  const verdict = STATUS_HEADLINE[status] ?? "has been scored by the app";
  const score = formatNumber(input?.result?.score, 0);
  const confidence = input?.result?.confidence ?? "low";

  const headline = `${cropName} ${verdict}.`;

  if (nextActions.length === 0) {
    nextActions.push(
      "Show this result to your local agriculture officer before you buy seed."
    );
  }

  const summaryParts = [
    `${cropName} scored ${score} out of 100 for your farm.`,
    `The app is ${confidence} confidence about this, based on the details you entered.`,
  ];
  if (risks.length > 0) {
    summaryParts.push("Please read the risks listed above before you decide.");
  } else {
    summaryParts.push("No major problem was found for this crop.");
  }

  return {
    headline,
    whyThisCrop: capList(whyThisCrop),
    risks: capList(risks),
    nextActions: capList(nextActions),
    plainLanguageSummary: summaryParts.join(" "),
  };
}

/**
 * Create the explain-recommendation task.
 *
 * `deps.localProvider` is injected rather than constructed so tests can supply a stub and so
 * the offline path is explicit at the call site instead of hidden inside the task.
 */
export function createExplainRecommendationTask(deps: {
  localProvider: ExplanationProvider;
}): AiTaskDefinition<ExplainRecommendationInput, ExplanationOutput> {
  const localProvider: ExplanationProvider =
    deps && deps.localProvider
      ? deps.localProvider
      : new LocalTemplateExplanationProvider();

  return {
    id: "explain-recommendation",
    label: "Explain crop recommendation",
    buildPrompt: buildExplainRecommendationPrompt,
    schema: ExplanationOutputSchema,
    geminiResponseSchema: GEMINI_RESPONSE_SCHEMAS["explain-recommendation"],

    async fallback(input: ExplainRecommendationInput): Promise<ExplanationOutput> {
      try {
        const text = await localProvider.explainRecommendation(
          input.result,
          input.profile
        );
        return adaptLocalExplanation(text, input);
      } catch {
        // The local template is pure string building and should never throw, but this task's
        // whole promise is "always returns something", so it degrades once more rather than
        // propagating.
        return adaptLocalExplanation("", input);
      }
    },

    /**
     * Keyed on everything that can change the wording: the crop, the engine's verdict, and
     * the farm inputs that produced it. Two different farms never share a cached explanation.
     */
    cacheKey(input: ExplainRecommendationInput): string {
      const r = input?.result;
      const p = input?.profile;
      const parts = [
        r?.crop?.id ?? "unknown-crop",
        formatNumber(r?.score, 0),
        r?.decisionStatus ?? "",
        r?.confidence ?? "",
        formatNumber(p?.ph, 2),
        formatNumber(p?.nitrogenKgPerAcre, 1),
        formatNumber(p?.phosphorusKgPerAcre, 1),
        formatNumber(p?.potassiumKgPerAcre, 1),
        (p?.soilType ?? "").toLowerCase().trim(),
        (p?.region ?? "").toLowerCase().trim(),
        formatNumber(p?.currentMonth, 0),
      ];
      return `explain:${parts.join("|")}`;
    },

    // Low temperature: this is a rewording job, not a creative one.
    temperature: 0.2,
    timeoutMs: 20_000,
    cacheTtlMs: 24 * 60 * 60 * 1_000,
  };
}
