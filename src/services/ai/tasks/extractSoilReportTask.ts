/**
 * Task definition: `extract-soil-report`.
 *
 * Reads pH and available N/P/K off a photographed Soil Health Card or lab report.
 *
 * There is no meaningful offline equivalent of optical character recognition, so unlike the
 * other three tasks the fallback here cannot reproduce the feature - it can only fail safely.
 * It returns an all-null extraction with `documentRecognised: false`, which the UI reads as
 * "type the values in yourself". That is the correct degradation: the alternative, guessing,
 * would push a fabricated pH into `FarmProfile` and change which crop a farmer sows.
 */

import type { AiTaskDefinition, InlineImage } from "../contracts/aiTypes";
import { GEMINI_RESPONSE_SCHEMAS, SoilReportExtractionSchema } from "../contracts/aiSchemas";
import type { SoilReportExtraction } from "../contracts/aiSchemas";
import {
  buildExtractSoilReportPrompt,
  type ExtractSoilReportInput,
} from "../prompts/extractSoilReportPrompt";
import { stableHash } from "../prompts/promptFormat";

/** The safe, empty reading returned whenever the document could not be read at all. */
export function createEmptySoilExtraction(warning: string): SoilReportExtraction {
  return {
    ph: null,
    nitrogenKgPerAcre: null,
    phosphorusKgPerAcre: null,
    potassiumKgPerAcre: null,
    documentRecognised: false,
    confidence: "low",
    warnings: [warning],
  };
}

/** Create the extract-soil-report task. */
export function createExtractSoilReportTask(): AiTaskDefinition<
  ExtractSoilReportInput,
  SoilReportExtraction
> {
  return {
    id: "extract-soil-report",
    label: "Read soil report card",
    buildPrompt: buildExtractSoilReportPrompt,
    schema: SoilReportExtractionSchema,
    geminiResponseSchema: GEMINI_RESPONSE_SCHEMAS["extract-soil-report"],

    fallback(): SoilReportExtraction {
      return createEmptySoilExtraction(
        "Automatic reading is unavailable right now, so no values were taken from the image. Please enter your soil test values by hand."
      );
    },

    /**
     * Hashed from the image bytes, so re-uploading the same card replays the cached reading
     * instead of costing another multimodal call. The base64 payload is never stored in the
     * key itself - only a 32-bit digest of it plus its length.
     */
    cacheKey(input: ExtractSoilReportInput): string {
      const image: InlineImage | undefined = input?.image;
      const data = typeof image?.base64Data === "string" ? image.base64Data : "";
      const mime = typeof image?.mimeType === "string" ? image.mimeType : "";
      return `soil:${mime}:${data.length}:${stableHash(data)}`;
    },

    // Zero temperature: this is transcription. Any creativity here is a defect.
    temperature: 0,
    // Multimodal calls are slower than text; give the image time to upload and be read.
    timeoutMs: 45_000,
    cacheTtlMs: 7 * 24 * 60 * 60 * 1_000,
  };
}
