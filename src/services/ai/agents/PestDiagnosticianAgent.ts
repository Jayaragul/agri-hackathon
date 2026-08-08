/**
 * Antigravity ADK Pest Diagnostician Agent.
 *
 * Multimodal diagnostic agent specialized in visual pest matching against
 * verified agronomic datasets (TNAU/ICAR package of practices).
 */

import { AntigravityAdkAgent } from "./AntigravityAdkAgent";
import type { IdentifyPestInput } from "../prompts/identifyPestPrompt";
import {
  IDENTIFY_PEST_SYSTEM_PROMPT,
  buildIdentifyPestUserPrompt
} from "../prompts/identifyPestPrompt";
import type { PestIdentification } from "../contracts/aiSchemas";
import { PestIdentificationSchema } from "../contracts/aiSchemas";
import type { PromptPayload } from "../contracts/aiTypes";

export class PestDiagnosticianAgent extends AntigravityAdkAgent<IdentifyPestInput, PestIdentification> {
  constructor() {
    super({
      name: "PestDiagnosticianAgent",
      role: "Multimodal Crop Protection & Pest Diagnostician",
      instruction: IDENTIFY_PEST_SYSTEM_PROMPT,
      model: "gemini-3.6-flash",
      temperature: 0.1
    });
  }

  public buildPrompt(input: IdentifyPestInput): PromptPayload {
    return {
      system: this.instruction,
      user: buildIdentifyPestUserPrompt(input),
      images: [input.image]
    };
  }

  public parseOutput(rawText: string): PestIdentification {
    let clean = rawText.trim();
    if (clean.startsWith("```")) {
      clean = clean.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    const parsed = JSON.parse(clean);
    return PestIdentificationSchema.parse(parsed);
  }
}
