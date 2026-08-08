/**
 * Antigravity ADK Soil Report Extractor Agent.
 *
 * Multimodal perception agent specialized in reading Indian Soil Health Cards (SHC)
 * and laboratory test reports, enforcing strict unit conversion (kg/ha to kg/acre)
 * and zero-hallucination safety guards.
 */

import { AntigravityAdkAgent } from "./AntigravityAdkAgent";
import type { ExtractSoilReportInput } from "../prompts/extractSoilReportPrompt";
import {
  EXTRACT_SOIL_REPORT_SYSTEM_PROMPT,
  buildExtractSoilReportUserPrompt
} from "../prompts/extractSoilReportPrompt";
import type { SoilReportExtraction } from "../contracts/aiSchemas";
import { SoilReportExtractionSchema } from "../contracts/aiSchemas";
import type { PromptPayload } from "../contracts/aiTypes";

export class SoilReportExtractorAgent extends AntigravityAdkAgent<ExtractSoilReportInput, SoilReportExtraction> {
  constructor() {
    super({
      name: "SoilReportExtractorAgent",
      role: "Multimodal Document Intelligence Specialist",
      instruction: EXTRACT_SOIL_REPORT_SYSTEM_PROMPT,
      model: "gemini-3.6-flash",
      temperature: 0.1
    });
  }

  public buildPrompt(input: ExtractSoilReportInput): PromptPayload {
    return {
      system: this.instruction,
      user: buildExtractSoilReportUserPrompt(),
      images: [input.image]
    };
  }

  public parseOutput(rawText: string): SoilReportExtraction {
    let clean = rawText.trim();
    if (clean.startsWith("```")) {
      clean = clean.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    const parsed = JSON.parse(clean);
    return SoilReportExtractionSchema.parse(parsed);
  }
}
