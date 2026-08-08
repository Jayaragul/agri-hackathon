/**
 * Validation contracts for every AI task output (zod v3).
 *
 * These schemas are the harness's trust boundary: no model response reaches the UI or the
 * store until it has passed `safeParse` here. They are deliberately narrow — note what they
 * do NOT contain: no scores, no rankings, no costs, no chemical dosing fields. The
 * deterministic engine owns all of those, and the AI layer is structurally prevented from
 * returning them.
 *
 * `GEMINI_RESPONSE_SCHEMAS` mirrors each zod schema as a plain JSON-Schema-shaped object for
 * `config.responseSchema`, so the model is constrained on the way out as well as validated
 * on the way in.
 */

import { z } from "zod";
import type { AiTaskId } from "./aiTypes";

/**
 * Shared confidence vocabulary for every perception task. Matches the engine's existing
 * `high | medium | low` tiers so the UI can render one badge component everywhere.
 */
const ConfidenceEnum = z.enum(["high", "medium", "low"]);

/**
 * Narrative explanation of a recommendation the engine has ALREADY produced.
 *
 * The model rewords the engine's decision trace; it never re-scores. Arrays are capped at 6
 * so a verbose response cannot flood a farmer's screen, and `plainLanguageSummary` is the
 * low-literacy / text-to-speech surface.
 */
export const ExplanationOutputSchema = z.object({
  headline: z.string().min(1),
  whyThisCrop: z.array(z.string()).max(6),
  risks: z.array(z.string()).max(6),
  nextActions: z.array(z.string()).max(6),
  plainLanguageSummary: z.string().min(1),
});

/**
 * Values read off a photographed soil-test report (OCR + interpretation).
 *
 * Every numeric field is nullable on purpose: "not legible" must be representable, because
 * a hallucinated number here would flow into `FarmProfile` and silently change a
 * recommendation. Ranges mirror `FarmProfileSchema` (pH 0-14, NPK 0-500 kg/acre) so an
 * out-of-range read is rejected rather than propagated. `documentRecognised` lets the UI
 * distinguish "this is not a soil report" from "this is a soil report I could not read".
 */
export const SoilReportExtractionSchema = z.object({
  ph: z.number().min(0).max(14).nullable(),
  nitrogenKgPerAcre: z.number().min(0).max(500).nullable(),
  phosphorusKgPerAcre: z.number().min(0).max(500).nullable(),
  potassiumKgPerAcre: z.number().min(0).max(500).nullable(),
  documentRecognised: z.boolean(),
  confidence: ConfidenceEnum,
  warnings: z.array(z.string()),
});

/**
 * Result of matching a crop photo against the verified pest dataset.
 *
 * `matchedKnownPestId` is a dataset id (`p001`-`p015`) or null — the model SELECTS from the
 * closed set, it does not invent a pest. All treatment text is then looked up from
 * `src/data/sample/pests.ts`, which is why no control/dosing field exists here at all.
 * `imageIsPlant` guards against confidently classifying an unrelated photo.
 */
export const PestIdentificationSchema = z.object({
  matchedKnownPestId: z.string().nullable(),
  matchedPestName: z.string().nullable(),
  confidence: ConfidenceEnum,
  observedSymptoms: z.array(z.string()).max(6),
  imageIsPlant: z.boolean(),
  reasoning: z.string(),
});

/**
 * A search-grounded mandi price lookup — the one task whose value genuinely comes from live
 * data rather than the local dataset.
 *
 * `pricePerKg` is nullable because "no reliable price found" must be expressible instead of
 * guessed. This is advisory display data only: it never feeds `financialEngine`, which uses
 * the dataset's `marketPricePerKg`. `sourceUrls` carries grounding citations so the number
 * is always attributable.
 */
export const MarketPriceSchema = z.object({
  pricePerKg: z.number().positive().nullable(),
  currency: z.string(),
  marketName: z.string().nullable(),
  asOf: z.string().nullable(),
  confidence: ConfidenceEnum,
  sourceUrls: z.array(z.string()),
});

/**
 * Answer to a farmer's free-text question about one calendar day.
 *
 * `citedFacts` must be a subset of the strings the prompt actually supplied for that day
 * (phase label, tasks, risks) — the prompt instructs the model to copy them verbatim rather
 * than paraphrase, so the UI can show exactly which deterministic facts backed the answer,
 * and a reviewer can spot an ungrounded claim at a glance.
 */
export const CalendarAnswerSchema = z.object({
  answer: z.string().min(1),
  citedFacts: z.array(z.string()).max(6),
});

/** Validated answer to a farmer's question about one calendar day. */
export type CalendarAnswer = z.infer<typeof CalendarAnswerSchema>;

/** Validated answer to a farmer's open-ended farming question. */
export type FarmAdvisorAnswer = z.infer<typeof FarmAdvisorAnswerSchema>;

/**
 * Answer to a farmer's open-ended farming question (soil, crops, pests, irrigation, general
 * practice) — NOT scoped to one calendar day or one recommendation. Grounded in the verified
 * local knowledge base (`src/data/wiki-kb.json`) and, when available, the farmer's own profile
 * and top recommendation for personalization. `topics` names which knowledge-base entries (or
 * general subject areas) the answer drew on, so the farmer can see it wasn't invented.
 */
export const FarmAdvisorAnswerSchema = z.object({
  answer: z.string().min(1),
  topics: z.array(z.string()).max(6),
  confidence: ConfidenceEnum,
});

/** Validated narrative explanation for a single crop recommendation. */
export type ExplanationOutput = z.infer<typeof ExplanationOutputSchema>;

/** Validated soil-report reading; feed through `FarmProfileSchema` before storing. */
export type SoilReportExtraction = z.infer<typeof SoilReportExtractionSchema>;

/** Validated pest match against the closed `p001`-`p015` dataset. */
export type PestIdentification = z.infer<typeof PestIdentificationSchema>;

/** Validated, advisory-only market price with grounding citations. */
export type MarketPrice = z.infer<typeof MarketPriceSchema>;

/** Reused enum fragment for the JSON-Schema mirrors below. */
const CONFIDENCE_JSON_SCHEMA = {
  type: "string",
  enum: ["high", "medium", "low"],
  description: "How certain the model is: high, medium, or low.",
} as const;

/**
 * Provider-side JSON schemas passed as `config.responseSchema` (SDK) or
 * `generationConfig.responseSchema` (REST). They constrain generation; the zod schemas above
 * still validate the result, because structured-output mode is a strong hint, not a guarantee.
 *
 * `market-price` is deliberately ABSENT: it uses Google Search grounding, which cannot be
 * combined with JSON response mode. That task requests plain text and is parsed defensively.
 */
export const GEMINI_RESPONSE_SCHEMAS: Partial<Record<AiTaskId, object>> = {
  "explain-recommendation": {
    type: "object",
    properties: {
      headline: {
        type: "string",
        description: "One short sentence naming the crop and the verdict.",
      },
      whyThisCrop: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
        description: "Reasons drawn only from the supplied decision trace.",
      },
      risks: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
        description: "Risks drawn only from the supplied decision trace.",
      },
      nextActions: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
        description: "Concrete next steps. No chemical names or dosages.",
      },
      plainLanguageSummary: {
        type: "string",
        description: "Two or three simple sentences for a low-literacy reader.",
      },
    },
    required: [
      "headline",
      "whyThisCrop",
      "risks",
      "nextActions",
      "plainLanguageSummary",
    ],
  },

  "extract-soil-report": {
    type: "object",
    properties: {
      ph: {
        type: "number",
        nullable: true,
        description: "Soil pH between 0 and 14, or null if not legible.",
      },
      nitrogenKgPerAcre: {
        type: "number",
        nullable: true,
        description: "Available nitrogen in kg/acre (0-500), or null if not legible.",
      },
      phosphorusKgPerAcre: {
        type: "number",
        nullable: true,
        description: "Available phosphorus in kg/acre (0-500), or null if not legible.",
      },
      potassiumKgPerAcre: {
        type: "number",
        nullable: true,
        description: "Available potassium in kg/acre (0-500), or null if not legible.",
      },
      documentRecognised: {
        type: "boolean",
        description: "True only if the image is actually a soil test report.",
      },
      confidence: CONFIDENCE_JSON_SCHEMA,
      warnings: {
        type: "array",
        items: { type: "string" },
        description: "Unit mismatches, blur, or unreadable fields.",
      },
    },
    required: [
      "ph",
      "nitrogenKgPerAcre",
      "phosphorusKgPerAcre",
      "potassiumKgPerAcre",
      "documentRecognised",
      "confidence",
      "warnings",
    ],
  },

  "answer-calendar-question": {
    type: "object",
    properties: {
      answer: {
        type: "string",
        description: "Two or three plain-language sentences answering the farmer's question, using only the supplied day data.",
      },
      citedFacts: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
        description: "Facts copied verbatim from the day data that back the answer. Empty if none were used.",
      },
    },
    required: ["answer", "citedFacts"],
  },

  "answer-farm-question": {
    type: "object",
    properties: {
      answer: {
        type: "string",
        description: "Plain-language answer, personalized to the farmer's profile/crop when supplied, grounded in the provided knowledge-base context.",
      },
      topics: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
        description: "Knowledge-base entries or subject areas the answer drew on.",
      },
      confidence: CONFIDENCE_JSON_SCHEMA,
    },
    required: ["answer", "topics", "confidence"],
  },

  "identify-pest": {
    type: "object",
    properties: {
      matchedKnownPestId: {
        type: "string",
        nullable: true,
        description: "Id of the best matching candidate pest, or null if none match.",
      },
      matchedPestName: {
        type: "string",
        nullable: true,
        description: "Name of the matched candidate, copied exactly, or null.",
      },
      confidence: CONFIDENCE_JSON_SCHEMA,
      observedSymptoms: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
        description: "Symptoms visible in the photo itself.",
      },
      imageIsPlant: {
        type: "boolean",
        description: "False if the photo does not show a plant or crop.",
      },
      reasoning: {
        type: "string",
        description: "Short justification. Never include treatment or dosage advice.",
      },
    },
    required: [
      "matchedKnownPestId",
      "matchedPestName",
      "confidence",
      "observedSymptoms",
      "imageIsPlant",
      "reasoning",
    ],
  },
};
