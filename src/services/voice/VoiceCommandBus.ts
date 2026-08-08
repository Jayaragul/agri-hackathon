/**
 * Turns a raw voice transcript into a `farmStore` action and a spoken reply.
 *
 * Deliberately rule-based keyword matching, not an LLM call: navigation and reading back
 * numbers the engine already computed must be instant and 100% reproducible, and per
 * [[krishi-mitra-ai-boundary]] no AI output may drive app state. `parseVoiceIntent` is pure
 * and independently testable; `executeVoiceIntent` is the only place that touches the store.
 */
import type { AppStage, Crop, FarmProfile, RecommendationResult } from "../../domain/models/models";

export type VoiceIntent =
  | { type: "load_demo" }
  | { type: "go_to_stage"; stage: AppStage; label: string }
  | { type: "go_back" }
  | { type: "read_top_recommendation" }
  | { type: "unrecognized"; raw: string };

interface StageKeyword {
  stage: AppStage;
  label: string;
  keywords: string[];
}

const STAGE_KEYWORDS: StageKeyword[] = [
  { stage: "farm-profile", label: "farm profile", keywords: ["farm profile", "soil data", "start over"] },
  { stage: "recommendations", label: "crop recommendations", keywords: ["recommendation", "crop match", "which crop"] },
  { stage: "soil-corrections", label: "soil corrections", keywords: ["soil fix", "soil correction", "fix the soil"] },
  { stage: "financials", label: "financial plan", keywords: ["financial", "profit", "money", "cost"] },
  { stage: "pests", label: "pest risk", keywords: ["pest"] },
  { stage: "action-plan", label: "action plan", keywords: ["action plan", "final plan"] },
  { stage: "digital-twin", label: "digital twin", keywords: ["digital twin", "field monitor", "my field", "growth stage"] },
  { stage: "advisor", label: "farm advisor", keywords: ["advisor", "ask a question", "farm advisor"] },
];

export function parseVoiceIntent(rawTranscript: string): VoiceIntent {
  const text = rawTranscript.toLowerCase().trim();
  if (text.length === 0) return { type: "unrecognized", raw: rawTranscript };

  if (text.includes("demo")) return { type: "load_demo" };
  if (text.includes("go back") || text.includes("previous")) return { type: "go_back" };
  if (text.includes("read") || text.includes("explain") || text.includes("why")) {
    return { type: "read_top_recommendation" };
  }

  for (const entry of STAGE_KEYWORDS) {
    if (entry.keywords.some((keyword) => text.includes(keyword))) {
      return { type: "go_to_stage", stage: entry.stage, label: entry.label };
    }
  }

  return { type: "unrecognized", raw: rawTranscript };
}

export interface VoiceCommandContext {
  stage: AppStage;
  profile: FarmProfile | null;
  selectedCrop: Crop | null;
  recommendations: RecommendationResult[];
  loadDemoProfile: () => void;
  setStage: (stage: AppStage) => void;
}

const STAGE_ORDER: AppStage[] = [
  "farm-profile",
  "recommendations",
  "soil-corrections",
  "financials",
  "pests",
  "action-plan",
];

/** Executes the intent against the store and returns the sentence the agent should speak back. */
export function executeVoiceIntent(intent: VoiceIntent, ctx: VoiceCommandContext): string {
  switch (intent.type) {
    case "load_demo":
      ctx.loadDemoProfile();
      return "Loaded the demo farm profile. Here are your crop recommendations.";

    case "go_to_stage": {
      const needsProfile = intent.stage !== "farm-profile" && intent.stage !== "digital-twin" && intent.stage !== "advisor";
      if (needsProfile && !ctx.profile) {
        return "Please fill in your farm profile first, or say 'load demo' to try a sample farm.";
      }
      const needsCrop = intent.stage === "soil-corrections" || intent.stage === "financials" || intent.stage === "pests" || intent.stage === "action-plan";
      if (needsCrop && !ctx.selectedCrop) {
        return "Please choose a crop from your recommendations first.";
      }
      ctx.setStage(intent.stage);
      return `Opening ${intent.label}.`;
    }

    case "go_back": {
      const currentIndex = STAGE_ORDER.indexOf(ctx.stage);
      if (currentIndex <= 0) return "You're already at the first step.";
      ctx.setStage(STAGE_ORDER[currentIndex - 1]);
      return "Going back one step.";
    }

    case "read_top_recommendation": {
      const top = ctx.recommendations[0];
      if (!top) return "No recommendations yet. Load your farm profile first.";
      return `${top.crop.name} scored ${Math.round(top.score)} out of 100, with ${top.confidence} confidence.`;
    }

    case "unrecognized":
    default:
      return "Sorry, I didn't catch that. Try saying 'load demo', 'show recommendations', or 'read the result'.";
  }
}
