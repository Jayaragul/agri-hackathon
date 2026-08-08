/**
 * Antigravity ADK Market Intelligence Agent.
 *
 * Grounded intelligence agent with web search tooling for live APMC / Mandi commodity price discovery.
 */

import { AntigravityAdkAgent } from "./AntigravityAdkAgent";
import type { MarketPriceInput } from "../prompts/marketPricePrompt";
import {
  MARKET_PRICE_SYSTEM_PROMPT,
  buildMarketPriceUserPrompt
} from "../prompts/marketPricePrompt";
import type { MarketPrice } from "../contracts/aiSchemas";
import { MarketPriceSchema } from "../contracts/aiSchemas";
import type { PromptPayload } from "../contracts/aiTypes";

export class MarketIntelligenceAgent extends AntigravityAdkAgent<MarketPriceInput, MarketPrice> {
  constructor() {
    super({
      name: "MarketIntelligenceAgent",
      role: "Agricultural Market & Commodity Price Specialist",
      instruction: MARKET_PRICE_SYSTEM_PROMPT,
      model: "gemini-3.6-flash",
      temperature: 0.1
    });

    // Register search tool metadata
    this.registerTool({
      name: "google_search",
      description: "Search live Indian agricultural mandi and wholesale prices",
      execute: async () => ({ status: "grounding_enabled" })
    });
  }

  public buildPrompt(input: MarketPriceInput): PromptPayload {
    return {
      system: this.instruction,
      user: buildMarketPriceUserPrompt(input),
      useSearchGrounding: true
    };
  }

  public parseOutput(rawText: string): MarketPrice {
    let clean = rawText.trim();
    if (clean.startsWith("```")) {
      clean = clean.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }

    const parsed = JSON.parse(clean);
    return MarketPriceSchema.parse(parsed);
  }
}
