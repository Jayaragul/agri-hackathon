/**
 * Task definition: `market-price`.
 *
 * The only search-grounded task in the harness, and the only one with no
 * `geminiResponseSchema` - Google Search grounding and JSON response mode are mutually
 * exclusive on this provider, so the prompt asks for plain-text JSON and the harness parses
 * it defensively.
 *
 * The fallback is the app's existing behaviour: the static `crop.marketPricePerKg` from the
 * demo dataset, labelled as a dataset average rather than a live quote, at low confidence.
 * The financial engine uses that same static figure in every case, so a live price never
 * changes a cost, profit, ROI or break-even number - it is displayed beside them as context.
 */

import type { AiTaskDefinition } from "../contracts/aiTypes";
import { MarketPriceSchema } from "../contracts/aiSchemas";
import type { MarketPrice } from "../contracts/aiSchemas";
import {
  buildMarketPricePrompt,
  type MarketPriceInput,
} from "../prompts/marketPricePrompt";

/** Label used wherever the dataset average stands in for a live quote. */
export const DATASET_AVERAGE_LABEL =
  "Dataset average - not a live market quote";

/**
 * The offline answer: the bundled demo-dataset price, explicitly labelled as such.
 *
 * `pricePerKg` must stay positive to satisfy the schema, so a missing or non-positive dataset
 * price degrades to `null` rather than to zero.
 */
export function createDatasetAveragePrice(input: MarketPriceInput): MarketPrice {
  const raw = input?.crop?.marketPricePerKg;
  const usable = typeof raw === "number" && Number.isFinite(raw) && raw > 0;
  return {
    pricePerKg: usable ? raw : null,
    currency: "INR",
    marketName: DATASET_AVERAGE_LABEL,
    asOf: null,
    confidence: "low",
    sourceUrls: [],
  };
}

/** Create the market-price task. */
export function createMarketPriceTask(): AiTaskDefinition<MarketPriceInput, MarketPrice> {
  return {
    id: "market-price",
    label: "Look up market price",
    buildPrompt: buildMarketPricePrompt,
    schema: MarketPriceSchema,
    // Deliberately no geminiResponseSchema: search grounding forbids JSON response mode.

    fallback(input: MarketPriceInput): MarketPrice {
      return createDatasetAveragePrice(input);
    },

    cacheKey(input: MarketPriceInput): string {
      const cropId = input?.crop?.id ?? "unknown-crop";
      const region = (input?.region ?? "").toLowerCase().trim();
      return `price:${cropId}:${region}`;
    },

    // Slightly above zero: the model has to phrase a search, not just transcribe.
    temperature: 0.1,
    // Grounded calls fan out to search before answering, so they need a longer budget.
    timeoutMs: 30_000,
    // Prices move. Six hours keeps the quote fresh while still absorbing repeat views.
    cacheTtlMs: 6 * 60 * 60 * 1_000,
  };
}
