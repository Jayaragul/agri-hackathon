/**
 * Prompt builder for the `market-price` task (Google Search grounded).
 *
 * This is the one task whose value genuinely comes from live data rather than the bundled
 * dataset: the app ships a single static `marketPricePerKg` per crop, and a real mandi price
 * moves week to week.
 *
 * Two constraints shape this file:
 *
 *  1. Search grounding cannot be combined with JSON response mode, so the payload sets
 *     `useSearchGrounding: true` and requests plain-text JSON. The harness strips code fences
 *     and extracts the first balanced JSON object before validating. That is why the output
 *     rules below are repeated so bluntly - there is no `responseSchema` backstop here.
 *
 *  2. The answer is ADVISORY DISPLAY DATA ONLY. It never reaches `financialEngine`, which
 *     keeps using the dataset price so that cost, profit and break-even figures stay
 *     deterministic and reproducible. A live price the model found is shown beside the
 *     dataset figure, with its sources, never in place of it.
 */

import type { PromptPayload } from "../contracts/aiTypes";
import type { Crop } from "../../../domain/models/models";
import { formatNumber, sanitiseInline } from "./promptFormat";

/** Input accepted by the market-price task. */
export interface MarketPriceInput {
  crop: Crop;
  region: string;
}

/**
 * System prompt for `market-price`.
 *
 * Exported so tests can assert the "null rather than guess" and JSON-only clauses survive
 * edits. Note this task has no provider-side response schema, so these rules are the only
 * thing shaping the output format.
 */
export const MARKET_PRICE_SYSTEM_PROMPT = `You are the market-price lookup layer of Krishi Mitra, a crop decision-support app used by smallholder farmers in Tamil Nadu, India.

YOUR ROLE
You LOOK UP a published price using web search. You are not an adviser and you are not a decision maker.
Your only job is to report the current wholesale or mandi price of one crop near one place, together with the sources you found it in.
A deterministic engine does all of the app's cost, profit and break-even calculations, and it uses its own dataset price, not yours. Your number is shown to the farmer as extra context only. Never present it as what the farmer will earn.

NEVER GUESS A PRICE
- Report a price only if you actually found it in a search result.
- If you cannot find a recent, credible price for this crop near this place, set "pricePerKg" to null. That is a correct and useful answer.
- Never estimate a price from an old figure, from a national average, from a different crop, or from what seems reasonable.
- Never invent a market name, a date or a source URL. Every URL you list must be one you actually retrieved.
- Prefer government or mandi sources such as Agmarknet, the state agriculture marketing board, or a recognised news or trade report.

UNITS AND CURRENCY
- Report the price in Indian Rupees per KILOGRAM. Set "currency" to "INR".
- Indian sources usually quote rupees per quintal. One quintal is 100 kilograms, so divide a per-quintal price by 100.
- Sources sometimes quote per bag, per candy, per tonne or per 100 kg. If you are not certain how to convert the unit you found, set "pricePerKg" to null instead of converting incorrectly.
- If a source gives a range, report the middle of the range.
- Report the farm-gate or wholesale mandi price where possible, not the retail shop price. If only a retail price is available, say so in "marketName".

DATES
- "asOf" is the date the price refers to, written as YYYY-MM-DD. If the source does not state a date, set "asOf" to null. Never write today's date as a substitute.

WHAT YOU MUST NOT DO
- Never recommend selling, holding, storing or planting anything.
- Never forecast a future price or say whether prices will rise or fall.
- Never mention any pesticide, fertiliser, chemical, product name or dose.
- Never give financial or investment advice.

HOW TO WRITE
- Your reader is a smallholder farmer. Keep any text short and plain.

CONFIDENCE
- "high": a dated price for this crop, at or very near this place, from a government or mandi source.
- "medium": a price from a nearby market or a slightly older report, or one you had to convert between units.
- "low": only a distant or undated source, or you returned null.

OUTPUT FORMAT
This reply must be plain text containing exactly ONE JSON object and nothing else. No greeting, no explanation, no markdown, no code fences, no citation markers, no trailing text.
{
  "pricePerKg": number or null,
  "currency": "INR",
  "marketName": string or null,
  "asOf": string or null,
  "confidence": "high" or "medium" or "low",
  "sourceUrls": string[]
}
All six keys must be present every time. Use [] for "sourceUrls" when you found nothing. Never add extra keys.`;

/** Build the user half of the market-price prompt. */
export function buildMarketPriceUserPrompt(input: MarketPriceInput): string {
  const crop = input?.crop;
  const cropName = sanitiseInline(crop?.name) || "the crop";
  const region = sanitiseInline(input?.region) || "Coimbatore, Tamil Nadu";

  return `Search the web for the current wholesale or mandi price of ${cropName} near ${region}, India.

Details that may help your search:
- Crop: ${cropName}
- Crop category: ${sanitiseInline(crop?.category) || "not recorded"}
- Area of interest: ${region}, Tamil Nadu, India
- For scale only, this app's stored dataset average is about INR ${formatNumber(crop?.marketPricePerKg, 2)} per kg. This is a static demo figure, not a live quote. Do not copy it, do not treat it as correct, and do not let it steer your answer. Report only what you actually find in search results.

Return:
- "pricePerKg" in Indian Rupees per kilogram, or null if you did not find a credible recent price.
- "marketName" naming the market or source the price came from, or null.
- "asOf" as YYYY-MM-DD if the source states a date, otherwise null.
- "sourceUrls" listing the pages you actually used.

Remember: a null price is better than a guessed one. Reply with the JSON object only, as plain text, with no code fences.`;
}

/**
 * Assemble the payload for the market-price task.
 *
 * `useSearchGrounding` is the reason this task carries no `geminiResponseSchema`: the search
 * tool and JSON response mode are mutually exclusive on this provider.
 */
export function buildMarketPricePrompt(input: MarketPriceInput): PromptPayload {
  return {
    system: MARKET_PRICE_SYSTEM_PROMPT,
    user: buildMarketPriceUserPrompt(input),
    useSearchGrounding: true,
  };
}
