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

// Words too generic to signal topical relevance on their own — left unfiltered, "crop", "soil",
// and "what" would spuriously match nearly every entry (e.g. a question about crop SELECTION
// scoring against an entry that merely mentions "soil fungus" or "protect crops" in passing),
// producing a confident-looking but topically unrelated answer instead of an honest "no match".
const STOPWORDS = new Set([
  "what", "why", "how", "when", "where", "which", "who", "does", "did", "should", "would",
  "could", "can", "will", "the", "and", "for", "are", "was", "were", "with", "from", "this",
  "that", "have", "has", "had", "you", "your", "about", "into", "out", "grow", "growing",
  "best", "good", "need", "needs", "want", "give", "tell", "get", "use", "using",
  "crop", "crops", "soil", "farm", "farming", "plant", "plants",
]);

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2)
  );
}

/**
 * Rank knowledge-base entries by exact-word keyword overlap with `question`; ties broken by
 * original order. Exact whole-word matching (not substring) is deliberate: a naive `.includes()`
 * check let a query word like "crop" match an unrelated entry's "crops" or "soil" match "soil
 * fungus", pulling in topically wrong entries whenever the query happened to share one common
 * word with them. Stopwords are excluded from scoring so a generic word shared with many entries
 * can't outweigh (or fake) a real topical match on its own.
 */
export function findKnowledgeEntries(question: string, limit = 2): KnowledgeEntry[] {
  const words = [...tokenize(question)].filter((word) => !STOPWORDS.has(word));
  if (words.length === 0) return [];

  return knowledgeBase
    .map((entry) => {
      const haystack = tokenize(`${entry.question} ${entry.keywords.join(" ")}`);
      const score = words.reduce((total, word) => total + (haystack.has(word) ? 1 : 0), 0);
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
  topRecommendation?: RecommendationResult | null,
  spokenStyle = false
): FarmAdvisorAnswer {
  const matches = findKnowledgeEntries(question, 2);
  const context = summariseFarmContext(profile, crop, topRecommendation);

  if (spokenStyle) {
    const tamilContext = profile
      ? `உங்கள் பண்ணை ${profile.region} பகுதியில் உள்ளது. பரப்பளவு ${profile.acres} ஏக்கர். மண் வகை ${profile.soilType}. மண் pH ${profile.ph}. கிடைக்கும் சத்துகள்: நைட்ரஜன் ${profile.nitrogenKgPerAcre}, பாஸ்பரஸ் ${profile.phosphorusKgPerAcre}, பொட்டாசியம் ${profile.potassiumKgPerAcre} கிலோ ஏக்கருக்கு.`
      : "பண்ணை விவரங்கள் இன்னும் பதிவு செய்யப்படவில்லை.";
    const recommendation = topRecommendation
      ? `சிறந்த பயிர் பரிந்துரை ${topRecommendation.crop.name}. மதிப்பெண் ${Math.round(topRecommendation.score)}. நம்பகத்தன்மை ${topRecommendation.confidence}.`
      : "பயிர் பரிந்துரைக்கு மண் மற்றும் பண்ணை விவரங்களை முதலில் பதிவு செய்யுங்கள்.";
    return {
      confidence: matches.length > 0 ? "medium" : "low",
      topics: matches.length > 0 ? matches.map((match) => match.question) : ["Farm context"],
      answer: `சரிபார்க்கப்பட்ட உள்ளூர் தரவுத்தளத்தில் இருந்து கிடைத்த தகவலின் அடிப்படையில் வழிகாட்டுகிறேன். ${tamilContext} ${recommendation} மண் pH மற்றும் NPK அளவுகளுக்கு ஏற்ப முடிவு எடுங்கள். பூச்சிக்கொல்லி அளவு அல்லது கடுமையான பிரச்சினைக்கு அருகிலுள்ள KVK வேளாண் அதிகாரியை அணுகுங்கள்.`,
    };
  }

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
