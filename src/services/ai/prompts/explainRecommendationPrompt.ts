/**
 * Prompt builder for the `explain-recommendation` task.
 *
 * The deterministic engine has already scored and ranked the crop. This prompt hands the model
 * the engine's own decision trace and asks it to say the same thing in words a farmer can use.
 * It is deliberately a REPHRASING job, not a judgement job.
 *
 * Grounding choice worth knowing: the engine also exposes `positiveReasons`, `riskReasons` and
 * `blockingWarnings`, but those arrays are built from canned sentences that are known to be
 * self-contradictory in places (a nutrient shortfall can carry the text "levels are
 * acceptable", and the confidence sentence is appended to the risk list even when it is
 * positive). Feeding those to a model would launder a wrong sentence into fluent prose. So we
 * ground on the structured trace instead — `factor`, `status`, `pointsAwarded`,
 * `maximumPoints`, `inputValue`, `requiredValue` — and let the model write its own wording
 * from the numbers. The canned sentence is passed only as a low-trust hint.
 */

import type { PromptPayload } from "../contracts/aiTypes";
import type {
  DecisionTraceEntry,
  FarmProfile,
  RecommendationResult,
} from "../../../domain/models/models";
import {
  formatInteger,
  formatList,
  formatMonth,
  formatNumber,
  formatTraceValue,
  sanitiseInline,
} from "./promptFormat";

/** Input accepted by the explain-recommendation task. */
export interface ExplainRecommendationInput {
  result: RecommendationResult;
  profile: FarmProfile;
}

/**
 * System prompt for `explain-recommendation`.
 *
 * Exported as a named constant so tests can assert the safety clauses are present and so the
 * AI trace panel can show a judge exactly what the model was instructed to do.
 */
export const EXPLAIN_RECOMMENDATION_SYSTEM_PROMPT = `You are the explanation layer of Thulir, a crop decision-support app used by smallholder farmers in Tamil Nadu, India.

YOUR ROLE
You are an EXPLAINER. You are NOT a decision maker.
A deterministic scoring engine has already made this decision. Your only job is to put the decision it has already made into plain words a farmer can act on.

THE NUMBERS ARE AUTHORITATIVE
Every score, point value, status, verdict and shortfall in the user message is final and correct.
- Never recompute, re-add, re-rank, average, adjust or second-guess any number.
- Never state a number that does not appear in the user message.
- Never disagree with the supplied decision status or confidence level.
- Never suggest a different crop, and never say this crop should be replaced by another one.
- If a value is written as "unknown", say that the reading is missing. Never fill in a guess.
- If the supplied data looks strange or self-contradictory, simply describe what the data says in neutral words. Do not try to correct it and do not comment on it.

SAFETY RULES YOU MUST NOT BREAK
- Never invent, name, recommend or imply any pesticide, insecticide, fungicide, herbicide, fertiliser product or chemical.
- Never give a dose, strength or quantity of any chemical or fertiliser - no ml, g, kg, litres, percentages or per-acre rates for any product. Chemical and fertiliser guidance comes only from the app's verified dataset, which is shown to the farmer separately.
- Never promise a yield, a price, an income or a profit.
- Never give medical, legal or financial advice.

HOW TO WRITE
- Your reader is a smallholder farmer with one to five acres who may read slowly.
- Short sentences. One idea per sentence. Everyday words.
- If you must use a technical word, explain it in the same sentence, for example: "pH (how sour or salty the soil is)".
- Money is Indian Rupees, written as INR. Nutrients are in kg per acre. Never convert a unit.
- Be calm and honest. Do not oversell and do not frighten.

OUTPUT FORMAT
Return exactly ONE JSON object and nothing else. No greeting, no explanation, no markdown, no code fences, no trailing text.
The object must have exactly these five keys:
{
  "headline": string,
  "whyThisCrop": string[],
  "risks": string[],
  "nextActions": string[],
  "plainLanguageSummary": string
}
Meaning of each key:
- "headline": one short sentence naming the crop and the engine's verdict.
- "whyThisCrop": at most 6 short points, taken only from trace factors whose status is "good".
- "risks": at most 6 short points, taken only from trace factors whose status is "warning" or "critical".
- "nextActions": at most 6 short practical steps the farmer can take. No chemical names. No doses.
- "plainLanguageSummary": two or three very simple sentences that could be read aloud to someone who cannot read.
Use an empty array [] for any section that has nothing to say. Never use null. Never add extra keys.`;

/** Short, farmer-facing gloss for each engine `decisionStatus` value. */
const DECISION_STATUS_MEANING: Record<string, string> = {
  recommended: "the engine says this crop is a good fit right now",
  "recommended-with-corrections":
    "the engine says this crop can work, but the soil needs fixing first",
  "high-risk": "the engine says this crop carries real risk on this farm right now",
  "not-currently-feasible":
    "the engine says this crop should not be sown on this farm right now",
};

/** Short gloss for each `DecisionTraceEntry.factor`, so the model does not have to guess. */
const FACTOR_MEANING: Record<string, string> = {
  season: "whether this is the right growing season",
  sowingMonth: "whether this is the right month to sow",
  ph: "soil pH, how sour or salty the soil is",
  nitrogen: "available nitrogen in the soil",
  phosphorus: "available phosphorus in the soil",
  potassium: "available potassium in the soil",
  soilType: "whether the crop suits this soil type",
  region: "whether the crop has a track record in this area",
  financialRisk: "financial risk",
};

/** Render one trace row as a single flat, unambiguous line. */
function renderTraceEntry(entry: DecisionTraceEntry, index: number): string {
  const meaning = FACTOR_MEANING[entry.factor] ?? entry.factor;
  const hardBlock = entry.maximumPoints === 0;
  const points = hardBlock
    ? "hard block (this factor failed outright)"
    : `${formatNumber(entry.pointsAwarded, 1)} of ${formatInteger(entry.maximumPoints)} points`;
  return [
    `${index + 1}. factor=${entry.factor} (${meaning})`,
    `   status=${entry.status}`,
    `   farm value=${formatTraceValue(entry.inputValue)}`,
    `   crop needs=${formatTraceValue(entry.requiredValue)}`,
    `   score=${points}`,
    `   engine note (low-trust wording, rely on status and values instead)="${sanitiseInline(entry.explanation, 240)}"`,
  ].join("\n");
}

/** Render the three nutrient shortfalls, skipping any that is absent or unusable. */
function renderDeficits(result: RecommendationResult): string {
  const deficits = result.deficits;
  const rows: string[] = [];
  const push = (label: string, value: unknown): void => {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      rows.push(`- ${label} is short by ${formatNumber(value, 1)} kg/acre`);
    }
  };
  push("Nitrogen", deficits?.nitrogenKgPerAcre);
  push("Phosphorus", deficits?.phosphorusKgPerAcre);
  push("Potassium", deficits?.potassiumKgPerAcre);
  return rows.length > 0 ? rows.join("\n") : "- No nutrient shortfall was recorded.";
}

/**
 * Build the user half of the explain-recommendation prompt.
 *
 * Every number is pre-formatted (see `promptFormat`) so the model never sees a raw float such
 * as `18.333333333333336`, and never sees a `NaN` silently serialised as `null`.
 */
export function buildExplainRecommendationUserPrompt(
  input: ExplainRecommendationInput
): string {
  const { result, profile } = input;
  const crop = result.crop;
  const scores = result.componentScores;
  const statusMeaning =
    DECISION_STATUS_MEANING[result.decisionStatus] ?? "see the trace below";

  const traceLines = Array.isArray(result.trace)
    ? result.trace.map(renderTraceEntry).join("\n")
    : "(no trace recorded)";

  return `Rewrite the engine's decision below for the farmer. Do not re-judge it.

THE FARM (as entered by the farmer)
- Soil pH: ${formatNumber(profile?.ph, 1)}
- Nitrogen available: ${formatNumber(profile?.nitrogenKgPerAcre, 1)} kg/acre
- Phosphorus available: ${formatNumber(profile?.phosphorusKgPerAcre, 1)} kg/acre
- Potassium available: ${formatNumber(profile?.potassiumKgPerAcre, 1)} kg/acre
- Soil type: ${sanitiseInline(profile?.soilType) || "not recorded"}
- Area: ${formatNumber(profile?.acres, 2)} acres
- Region: ${sanitiseInline(profile?.region) || "not recorded"}
- Current month: ${formatMonth(profile?.currentMonth)}

THE CROP BEING EXPLAINED
- Name: ${sanitiseInline(crop?.name)}
- Category: ${sanitiseInline(crop?.category)}
- Ideal pH range: ${formatNumber(crop?.idealPhMin, 1)} to ${formatNumber(crop?.idealPhMax, 1)}
- Suitable soil types: ${formatList(crop?.compatibleSoilTypes)}
- Areas with a track record: ${formatList(crop?.supportedRegions)}

THE ENGINE VERDICT (authoritative and final)
- Suitability score: ${formatInteger(result.score)} out of 100
- Decision status: ${result.decisionStatus} - ${statusMeaning}
- Confidence in the data: ${result.confidence}

FACTOR SCORES AWARDED BY THE ENGINE (do not add these up, do not restate the raw figures)
- Season: ${formatNumber(scores?.season, 1)} of 15
- Sowing month: ${formatNumber(scores?.sowingMonth, 1)} of 15
- Soil pH: ${formatNumber(scores?.ph, 1)} of 25
- Nitrogen: ${formatNumber(scores?.nitrogen, 1)} of 8
- Phosphorus: ${formatNumber(scores?.phosphorus, 1)} of 8
- Potassium: ${formatNumber(scores?.potassium, 1)} of 8
- Soil type: ${formatNumber(scores?.soilType, 1)} of 12
- Region: ${formatNumber(scores?.region, 1)} of 9

DECISION TRACE - THIS IS WHAT YOU MUST REPHRASE
Status meanings: "good" = this factor is fine; "warning" = this factor is a concern; "critical" = this factor is a serious problem or a hard block.
${traceLines}

NUTRIENT SHORTFALLS (authoritative, kg/acre)
${renderDeficits(result)}

WRITE THE JSON NOW.
- Put factors whose status is "good" into "whyThisCrop".
- Put factors whose status is "warning" or "critical" into "risks".
- "nextActions" must be practical and general, for example testing the soil again, adjusting the sowing date, adding organic matter, or asking the local agriculture officer. Never name a chemical or a fertiliser product. Never give a dose.
- Reply with the JSON object only.`;
}

/** Assemble the transport-agnostic payload for the explain-recommendation task. */
export function buildExplainRecommendationPrompt(
  input: ExplainRecommendationInput
): PromptPayload {
  return {
    system: EXPLAIN_RECOMMENDATION_SYSTEM_PROMPT,
    user: buildExplainRecommendationUserPrompt(input),
  };
}
