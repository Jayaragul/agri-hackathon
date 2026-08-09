/**
 * Skills genuinely executable through the real, external A2A JSON-RPC surface
 * (`routes/a2aRoutes.ts`) — as opposed to `src/services/ai/a2a/`'s six skills, which run
 * in-process in the browser against frontend state (`farmStore`) and are NOT reachable from
 * outside the app today.
 *
 * Deliberately scoped to two skills, not all six: `server/` and the frontend build under
 * incompatible module systems (server is CommonJS with `rootDir: "src"`; the frontend is ESM
 * under Vite) and there is no shared package between them, so nothing here is a re-export of
 * the frontend's prompts — it's this server's OWN implementation of the same skill CONTRACT
 * (same input/output shape, same [[krishi-mitra-ai-boundary]] discipline), kept intentionally
 * independent rather than a fragile cross-package import. `identify-pest` and
 * `extract-soil-report` are perception skills built around image handling nuances specific to
 * the frontend's closed-set datasets (`src/data/sample/pests.ts`) — porting those honestly
 * would mean porting the dataset too, which is out of scope for this pass; see "Extending this"
 * at the bottom of this file for what that would take.
 *
 * External callers never see an internal `FarmProfile`/`RecommendationResult` shape — the whole
 * point of A2A is interoperability with agents that know nothing about Krishi Mitra's internal
 * types, so both skills below define their own minimal, self-contained contracts.
 */
import { generateViaGemini, ProxyError } from "./geminiProxy";
import { resolveGeminiApiKey } from "./env";

export interface AnswerFarmQuestionInput {
  question: string;
  farmerName?: string;
  /** Freeform description of the farm's situation (crop, region, soil) — analogous to the frontend's `declaredSituation`; this skill has no access to a structured profile. */
  situation?: string;
}

export interface AnswerFarmQuestionOutput {
  answer: string;
  confidence: "high" | "medium" | "low";
  source: "gemini" | "local";
}

const FARM_QUESTION_SYSTEM_PROMPT = `You are the General Farm Advisor skill of Thulir, an AI decision-support app for smallholder farmers in Tamil Nadu, India, exposed here over the Agent2Agent (A2A) protocol for other agents/systems to call.

RULE: You explain and personalise. You never invent a specific soil reading, price, or recommendation score for a farm you have not been told about. For any pesticide/fertiliser dose or a severe crop-health question, tell the caller to confirm with a certified agronomist or local KVK extension officer — never state a dose or brand yourself.

Reply with plain, practical language in 2-4 sentences.`;

function localFarmAnswer(input: AnswerFarmQuestionInput): AnswerFarmQuestionOutput {
  const who = input.farmerName ? `${input.farmerName}, ` : "";
  const situation = input.situation ? ` Given your situation (${input.situation}),` : "";
  return {
    answer: `${who}I can't reach the live model right now, so here is general guidance only:${situation} for a specific answer to "${input.question}", please confirm with your local KVK extension officer. General principles: prefer biological/cultural controls before chemical ones, and never exceed a product label's stated dose.`,
    confidence: "low",
    source: "local",
  };
}

export async function runAnswerFarmQuestion(input: AnswerFarmQuestionInput): Promise<AnswerFarmQuestionOutput> {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey || !input.question?.trim()) return localFarmAnswer(input);

  const userPrompt = `${input.farmerName ? `Farmer's name: ${input.farmerName}.\n` : ""}${
    input.situation ? `Situation: ${input.situation}\n` : ""
  }Question: "${input.question}"\n\nReply with plain text only, 2-4 sentences.`;

  try {
    const reply = await generateViaGemini(apiKey, {
      system: FARM_QUESTION_SYSTEM_PROMPT,
      user: userPrompt,
      modelChain: ["gemini-3.6-flash", "gemini-3.5-flash"],
      temperature: 0.2,
      timeoutMs: 20_000,
    });
    return { answer: reply.text.trim(), confidence: "medium", source: "gemini" };
  } catch (err) {
    if (err instanceof ProxyError && err.status >= 400 && err.status < 500 && err.status !== 429) throw err;
    return localFarmAnswer(input);
  }
}

export interface ExplainRecommendationInput {
  cropName: string;
  /** 0-100, already computed by the caller's own decision engine — this skill never re-scores it. */
  score: number;
  decisionStatus: string;
  reasons?: string[];
  risks?: string[];
}

export interface ExplainRecommendationOutput {
  headline: string;
  explanation: string;
  source: "gemini" | "local";
}

const EXPLAIN_RECOMMENDATION_SYSTEM_PROMPT = `You are the Agronomist Explainer skill of Thulir, exposed over the Agent2Agent (A2A) protocol.

RULE: You are given a crop recommendation a deterministic engine has ALREADY scored and decided. You explain it in plain language for a farmer. You never change the score, the decision status, or invent a reason/risk that was not supplied to you.

Reply with plain text only: one headline sentence, then 2-3 sentences of explanation.`;

function localExplanation(input: ExplainRecommendationInput): ExplainRecommendationOutput {
  const reasons = input.reasons?.length ? ` Reasons: ${input.reasons.join("; ")}.` : "";
  const risks = input.risks?.length ? ` Risks: ${input.risks.join("; ")}.` : "";
  return {
    headline: `${input.cropName}: ${input.decisionStatus} (score ${Math.round(input.score)}/100)`,
    explanation: `This score and status came from the deterministic recommendation engine, not a live model.${reasons}${risks}`,
    source: "local",
  };
}

export async function runExplainRecommendation(input: ExplainRecommendationInput): Promise<ExplainRecommendationOutput> {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey || !input.cropName?.trim()) return localExplanation(input);

  const userPrompt = `Crop: ${input.cropName}\nScore: ${Math.round(input.score)}/100\nDecision status: ${input.decisionStatus}\nReasons: ${(input.reasons ?? []).join("; ") || "(none supplied)"}\nRisks: ${(input.risks ?? []).join("; ") || "(none supplied)"}\n\nExplain this in plain language. Reply with plain text only.`;

  try {
    const reply = await generateViaGemini(apiKey, {
      system: EXPLAIN_RECOMMENDATION_SYSTEM_PROMPT,
      user: userPrompt,
      modelChain: ["gemini-3.6-flash", "gemini-3.5-flash"],
      temperature: 0.2,
      timeoutMs: 20_000,
    });
    const text = reply.text.trim();
    const [firstLine, ...rest] = text.split("\n").filter(Boolean);
    return { headline: firstLine ?? text, explanation: rest.join(" ") || text, source: "gemini" };
  } catch (err) {
    if (err instanceof ProxyError && err.status >= 400 && err.status < 500 && err.status !== 429) throw err;
    return localExplanation(input);
  }
}

/**
 * Extending this: to add a real seventh skill here, follow the same shape as the two above —
 * (1) a minimal, self-contained input/output pair that doesn't leak an internal domain type,
 * (2) a `local*()` deterministic fallback that never throws, (3) a `run*()` that calls
 * `generateViaGemini` and falls back on any non-4xx failure, (4) register it as an
 * `A2AAgentSkill` in `routes/a2aRoutes.ts`'s discovery card AND in the `message/send` dispatch
 * switch. Never let a new skill here return a score, a ranking, a financial figure, or a dose —
 * that decision belongs in `src/engine/`, same rule as every other agent in this app.
 */
