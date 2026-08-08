/**
 * Drop-in AI replacement for `LocalTemplateExplanationProvider`.
 *
 * It implements the pre-existing `ExplanationProvider` interface from
 * `src/domain/models/models.ts` exactly, so `CropDecision.tsx` can swap providers without a
 * single line of UI change. That constraint is load-bearing in two ways:
 *
 *  1. `explainRecommendation` returns a plain string, and the existing renderer dispatches
 *     purely on line prefix - `**heading**`, `✅`, `⚠️`, `❌`, and anything else as an
 *     indented paragraph. So `renderExplanation` below re-emits the model's structured answer
 *     back into that exact vocabulary. Markdown bullets, hashes, tables or fenced code would
 *     silently lose their formatting, so none are produced.
 *
 *  2. The interface has no error channel, and the existing call site has no try/catch - a
 *     rejected promise there blanks every crop card. This class therefore never rejects: the
 *     harness already guarantees `run()` resolves, and the rendering step is additionally
 *     wrapped so a malformed payload degrades to the local template instead of throwing.
 */

import type {
  ExplanationProvider,
  FarmProfile,
  RecommendationResult,
} from "../../../domain/models/models";
import type { AiOutcome } from "../contracts/aiTypes";
import type { ExplanationOutput } from "../contracts/aiSchemas";
import type { AiHarness } from "../runtime/AiHarness";
import { LocalTemplateExplanationProvider } from "../../explanation/LocalTemplateExplanationProvider";
import {
  createExplainRecommendationTask,
  adaptLocalExplanation,
} from "../tasks/explainRecommendationTask";
import type { ExplainRecommendationInput } from "../prompts/explainRecommendationPrompt";

/**
 * Re-emit a structured explanation in the line-prefix format the existing renderer
 * understands.
 *
 * The leading `\n` on each section heading is intentional and load-bearing: the renderer sets
 * `white-space: pre-wrap`, so that newline is what produces the blank line separating
 * sections. It matches how the local template already builds its output.
 */
export function renderExplanation(
  output: ExplanationOutput,
  result: RecommendationResult
): string {
  const lines: string[] = [];
  const cropName = result?.crop?.name ?? "this crop";

  lines.push(`**Why ${cropName}?**`);

  const headline = typeof output?.headline === "string" ? output.headline.trim() : "";
  if (headline.length > 0) lines.push(headline);

  const why = Array.isArray(output?.whyThisCrop) ? output.whyThisCrop : [];
  if (why.length > 0) {
    for (const item of why) {
      const text = String(item).trim();
      if (text.length > 0) lines.push(`✅ ${text}`);
    }
  } else if (headline.length === 0) {
    lines.push("It is a viable option for this season.");
  }

  const risks = Array.isArray(output?.risks) ? output.risks : [];
  if (risks.length > 0) {
    lines.push(`\n**What are the risks?**`);
    for (const item of risks) {
      const text = String(item).trim();
      if (text.length > 0) lines.push(`⚠️ ${text}`);
    }
  }

  const actions = Array.isArray(output?.nextActions) ? output.nextActions : [];
  if (actions.length > 0) {
    lines.push(`\n**What to do next:**`);
    for (const item of actions) {
      const text = String(item).trim();
      if (text.length > 0) lines.push(`- ${text}`);
    }
  }

  const summary =
    typeof output?.plainLanguageSummary === "string"
      ? output.plainLanguageSummary.trim()
      : "";
  if (summary.length > 0) {
    lines.push(`\n**In short:**`);
    lines.push(summary);
  }

  return lines.join("\n");
}

/**
 * Harness-backed explanation provider.
 *
 * The harness is injected rather than resolved from a module singleton so tests can drive
 * this class with a `MockTransport` and assert on the prompt it produced.
 */
export class GeminiExplanationProvider implements ExplanationProvider {
  private readonly harness: AiHarness;
  private readonly localProvider: ExplanationProvider;
  private readonly task: ReturnType<typeof createExplainRecommendationTask>;

  constructor(harness: AiHarness, localProvider?: ExplanationProvider) {
    this.harness = harness;
    this.localProvider = localProvider ?? new LocalTemplateExplanationProvider();
    this.task = createExplainRecommendationTask({ localProvider: this.localProvider });
  }

  /**
   * The existing interface method. Always resolves to a renderable string - never rejects,
   * never resolves to an empty string.
   */
  public async explainRecommendation(
    result: RecommendationResult,
    profile: FarmProfile
  ): Promise<string> {
    try {
      const outcome = await this.explainStructured(result, profile);
      const rendered = renderExplanation(outcome.data, result);
      if (rendered.trim().length > 0) return rendered;
    } catch {
      // Fall through to the deterministic template below.
    }
    try {
      return await this.localProvider.explainRecommendation(result, profile);
    } catch {
      return `**Why ${result?.crop?.name ?? "this crop"}?**\nAn explanation is not available right now.`;
    }
  }

  /**
   * Full harness outcome, for callers that need provenance: which model answered, how long it
   * took, whether the answer was cached, degraded, or repaired after failing validation.
   * The AI trace panel and any structured UI use this rather than the string form.
   */
  public async explainStructured(
    result: RecommendationResult,
    profile: FarmProfile
  ): Promise<AiOutcome<ExplanationOutput>> {
    const input: ExplainRecommendationInput = { result, profile };
    try {
      return await this.harness.run(this.task, input);
    } catch {
      // `AiHarness.run` is contractually non-rejecting; this guards a broken injected double
      // so the UI contract ("always renders something") holds regardless.
      const text = await this.safeLocalString(result, profile);
      return {
        data: adaptLocalExplanation(text, input),
        source: "local",
        latencyMs: 0,
        degraded: true,
        validationRepaired: false,
        notes: ["AI harness was unavailable; used the built-in explanation template."],
      };
    }
  }

  /** Local template output, or an empty string if even that fails. */
  private async safeLocalString(
    result: RecommendationResult,
    profile: FarmProfile
  ): Promise<string> {
    try {
      return await this.localProvider.explainRecommendation(result, profile);
    } catch {
      return "";
    }
  }
}
