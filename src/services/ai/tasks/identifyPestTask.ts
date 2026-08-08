/**
 * Task definition: `identify-pest`.
 *
 * Constrained classification against the crop's verified pest list. The model picks one
 * dataset id or answers null; it never produces treatment text, which is looked up from
 * `src/data/sample/pests.ts` afterwards.
 *
 * The fallback returns "no match, low confidence" rather than a best guess. Combined with
 * `PestIdentificationService`, which drops any id the model returns that is not in the
 * supplied candidate list, this means a pest name can only ever reach the farmer if it
 * already existed in the vetted dataset.
 */

import type { AiTaskDefinition } from "../contracts/aiTypes";
import { GEMINI_RESPONSE_SCHEMAS, PestIdentificationSchema } from "../contracts/aiSchemas";
import type { PestIdentification } from "../contracts/aiSchemas";
import {
  buildIdentifyPestPrompt,
  type IdentifyPestInput,
} from "../prompts/identifyPestPrompt";
import { stableHash } from "../prompts/promptFormat";

/** The safe, no-match result used whenever the photo could not be classified. */
export function createNoPestMatch(reasoning: string): PestIdentification {
  return {
    matchedKnownPestId: null,
    matchedPestName: null,
    confidence: "low",
    observedSymptoms: [],
    imageIsPlant: false,
    reasoning,
  };
}

/** Create the identify-pest task. */
export function createIdentifyPestTask(): AiTaskDefinition<
  IdentifyPestInput,
  PestIdentification
> {
  return {
    id: "identify-pest",
    label: "Match pest photo",
    buildPrompt: buildIdentifyPestPrompt,
    schema: PestIdentificationSchema,
    geminiResponseSchema: GEMINI_RESPONSE_SCHEMAS["identify-pest"],

    fallback(): PestIdentification {
      return createNoPestMatch(
        "Photo matching is unavailable right now, so no pest was identified from the image. Compare the listed pests for your crop with what you can see in the field."
      );
    },

    /**
     * Keyed on the crop, the candidate set, and a digest of the image bytes. The candidate ids
     * are part of the key because the same photo must not replay a cached answer that was
     * produced against a different crop's shortlist.
     */
    cacheKey(input: IdentifyPestInput): string {
      const data =
        typeof input?.image?.base64Data === "string" ? input.image.base64Data : "";
      const cropId = input?.crop?.id ?? "unknown-crop";
      const candidateIds = Array.isArray(input?.candidates)
        ? input.candidates
            .map((p) => p?.id ?? "")
            .filter((id) => id.length > 0)
            .join(",")
        : "";
      return `pest:${cropId}:${candidateIds}:${data.length}:${stableHash(data)}`;
    },

    // Zero temperature: picking from a closed list should be reproducible.
    temperature: 0,
    timeoutMs: 45_000,
    cacheTtlMs: 7 * 24 * 60 * 60 * 1_000,
  };
}
