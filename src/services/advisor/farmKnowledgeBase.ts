/**
 * Deterministic keyword-matching retrieval over the verified local knowledge base
 * (`src/data/wiki-kb.json`) — general agronomy Q&A entries reviewed and shipped with the app,
 * distinct from the per-crop `sample/pests.ts` / `sample/corrections.ts` datasets.
 *
 * This is the offline-first backbone of the General Farm Advisor: `findKnowledgeEntries` is
 * used both as the deterministic fallback's source of truth (via `buildLocalFarmAnswer`) and as
 * grounding context handed to the model on a live call, so a Gemini answer is anchored to the
 * same verified entries a farmer would get offline, not a free-floating guess.
 */
import wikiKnowledgeRaw from "../../data/wiki-kb.json";
import type { Crop, FarmProfile, RecommendationResult } from "../../domain/models/models";
import type { FarmAdvisorAnswer } from "../ai/contracts/aiSchemas";

export interface KnowledgeEntry {
  id: string;
  keywords: string[];
  question: string;
  answer: string;
}

const knowledgeBase = wikiKnowledgeRaw as KnowledgeEntry[];

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
}

/** Rank knowledge-base entries by keyword overlap with `question`; ties broken by original order. */
export function findKnowledgeEntries(question: string, limit = 2): KnowledgeEntry[] {
  const words = normalize(question)
    .split(/\s+/)
    .filter((word) => word.length > 2);
  if (words.length === 0) return [];

  return knowledgeBase
    .map((entry) => {
      const haystack = normalize(`${entry.question} ${entry.keywords.join(" ")}`);
      const score = words.reduce((total, word) => total + (haystack.includes(word) ? 1 : 0), 0);
      return { entry, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit))
    .map((item) => item.entry);
}

/** One sentence of farm context, used both in the fallback answer and as prompt grounding. */
export function summariseFarmContext(
  profile?: FarmProfile | null,
  crop?: Crop | null,
  topRecommendation?: RecommendationResult | null
): string {
  if (!profile) return "No farm profile has been entered yet.";

  const parts = [
    `Farm: ${profile.region}, ${profile.acres} acre(s), ${profile.soilType} soil, pH ${profile.ph}.`,
    `Available nutrients: N ${profile.nitrogenKgPerAcre}, P ${profile.phosphorusKgPerAcre}, K ${profile.potassiumKgPerAcre} kg/acre.`,
  ];
  if (crop) parts.push(`Selected crop: ${crop.name} (ideal pH ${crop.idealPhMin}-${crop.idealPhMax}).`);
  if (topRecommendation) {
    parts.push(
      `Top recommendation: ${topRecommendation.crop.name} (${Math.round(topRecommendation.score)}/100, ${topRecommendation.confidence} confidence).`
    );
  }
  return parts.join(" ");
}

/**
 * Deterministic, always-available answer — the harness's mandatory `fallback` for
 * `answer-farm-question`. Never invents anything the knowledge base doesn't already say.
 */
export function buildLocalFarmAnswer(
  question: string,
  profile?: FarmProfile | null,
  crop?: Crop | null,
  topRecommendation?: RecommendationResult | null
): FarmAdvisorAnswer {
  const matches = findKnowledgeEntries(question, 2);
  const context = summariseFarmContext(profile, crop, topRecommendation);

  if (matches.length === 0) {
    return {
      confidence: "low",
      topics: ["Farm context"],
      answer:
        `I could not find a reliable answer in the verified local knowledge base. ${context} ` +
        "Try asking about soil pH, NPK, crop rotation, irrigation, pests, soil testing, or fertilizer options. " +
        "For pesticide dosage or a severe crop problem, confirm with a local KVK extension officer.",
    };
  }

  const personalised =
    profile && crop
      ? ` For this farm, compare this against ${crop.name}'s pH range (${crop.idealPhMin}-${crop.idealPhMax}) and your current soil readings before acting.`
      : profile
      ? ` For this farm: ${profile.soilType} soil at pH ${profile.ph} in ${profile.region}.`
      : "";

  return {
    confidence: matches.length > 1 ? "high" : "medium",
    topics: matches.map((match) => match.question),
    answer:
      `${matches.map((match) => match.answer).join("\n\n")}\n\n${context}${personalised}\n\n` +
      "This is offline, source-grounded guidance — not a substitute for a local agricultural expert.",
  };
}
