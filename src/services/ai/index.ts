/**
 * Public entry point for the Krishi Mitra AI harness.
 *
 * Everything the app touches goes through this barrel: the UI never constructs a transport,
 * a cache or a task, and never reads `import.meta.env` itself. That keeps one wiring decision
 * in one place, and means the whole AI layer can be swapped for the deterministic path by
 * changing nothing but an environment variable.
 *
 * The singletons are LAZY on purpose. Config is read from `import.meta.env` on first use
 * rather than at module load, so importing this file is free and cannot throw during boot.
 * `resetAiSingletons()` tears the whole graph down again, which is what tests use between
 * cases so a stubbed env or a stubbed transport does not leak across them.
 *
 * ARCHITECTURE REMINDER: nothing exported here may change a suitability score, a ranking, a
 * financial figure or a safety threshold. `src/engine/**` decides; this layer explains and
 * perceives.
 */

import type { ExplanationProvider } from "../../domain/models/models";
import type { AiTransport } from "./contracts/aiTypes";
import type { HarnessConfig } from "./runtime/harnessConfig";
import { isAiConfigured, loadHarnessConfig } from "./runtime/harnessConfig";
import { selectTransport } from "./transport/selectTransport";
import { ResponseCache } from "./runtime/ResponseCache";
import { HarnessTelemetry } from "./runtime/HarnessTelemetry";
import { AiHarness } from "./runtime/AiHarness";
import { GeminiExplanationProvider } from "./providers/GeminiExplanationProvider";
import { GeminiSoilReportExtractor } from "./providers/GeminiSoilReportExtractor";
import { PestIdentificationService } from "./providers/PestIdentificationService";
import { MarketPriceService } from "./providers/MarketPriceService";
import { LocalTemplateExplanationProvider } from "../explanation/LocalTemplateExplanationProvider";

/** localStorage key prefix for cached AI responses. Bump on a breaking schema change. */
const CACHE_NAMESPACE = "krishi-mitra.ai.v1";

let cachedConfig: HarnessConfig | null = null;
let cachedTransport: AiTransport | null = null;
let transportResolved = false;
let cachedCache: ResponseCache | null = null;
let cachedTelemetry: HarnessTelemetry | null = null;
let cachedHarness: AiHarness | null = null;

let cachedExplanationProvider: GeminiExplanationProvider | null = null;
let cachedSoilExtractor: GeminiSoilReportExtractor | null = null;
let cachedPestService: PestIdentificationService | null = null;
let cachedMarketService: MarketPriceService | null = null;

/** Resolved harness settings, read once from the environment. */
function getConfig(): HarnessConfig {
  if (cachedConfig === null) cachedConfig = loadHarnessConfig();
  return cachedConfig;
}

/**
 * The selected backend, or `null` when none is usable.
 *
 * `null` is a fully supported, non-exceptional state - it simply means every task routes to
 * its deterministic fallback. `transportResolved` distinguishes "not looked up yet" from
 * "looked up and there is none", so a missing key does not re-run selection on every call.
 */
function getTransport(): AiTransport | null {
  if (!transportResolved) {
    try {
      cachedTransport = selectTransport(getConfig());
    } catch {
      cachedTransport = null;
    }
    transportResolved = true;
  }
  return cachedTransport;
}

/** The shared response cache. */
function getCache(): ResponseCache {
  if (cachedCache === null) {
    cachedCache = new ResponseCache(CACHE_NAMESPACE, getConfig().cacheTtlMs);
  }
  return cachedCache;
}

/** The shared telemetry log powering the AI trace panel. */
export function getAiTelemetry(): HarnessTelemetry {
  if (cachedTelemetry === null) cachedTelemetry = new HarnessTelemetry();
  return cachedTelemetry;
}

/** The shared harness instance. */
export function getAiHarness(): AiHarness {
  if (cachedHarness === null) {
    cachedHarness = new AiHarness(
      getConfig(),
      getTransport(),
      getCache(),
      getAiTelemetry()
    );
  }
  return cachedHarness;
}

/**
 * The raw transport, for the one caller that needs to drive it directly instead of through
 * `AiHarness.run()` — `resolveToolCalls.ts`'s tool-decision pre-step, which must send a
 * `tools`-bearing prompt (mutually exclusive with the schema-validated JSON path `run()`
 * always takes) and read back `functionCalls`. Everything else in the app must keep going
 * through `getAiHarness().run()`.
 */
export function getAiTransport(): AiTransport | null {
  return getTransport();
}

/** Resolved harness settings, for the same tool-decision pre-step (needs `timeoutMs`/`enabled`). */
export function getAiHarnessConfig(): HarnessConfig {
  return getConfig();
}

/**
 * Drop-in `ExplanationProvider` for `CropDecision.tsx`.
 *
 * Returns the AI-backed provider, which itself falls back to
 * `LocalTemplateExplanationProvider` whenever the model is unavailable - so the caller gets
 * identical behaviour with or without an API key and needs no branch of its own.
 */
export function getExplanationProvider(): ExplanationProvider {
  return getStructuredExplanationProvider();
}

/** The same provider, typed so `explainStructured()` and its provenance are reachable. */
export function getStructuredExplanationProvider(): GeminiExplanationProvider {
  if (cachedExplanationProvider === null) {
    cachedExplanationProvider = new GeminiExplanationProvider(
      getAiHarness(),
      new LocalTemplateExplanationProvider()
    );
  }
  return cachedExplanationProvider;
}

/** Soil Health Card reader. */
export function getSoilReportExtractor(): GeminiSoilReportExtractor {
  if (cachedSoilExtractor === null) {
    cachedSoilExtractor = new GeminiSoilReportExtractor(getAiHarness());
  }
  return cachedSoilExtractor;
}

/** Pest photo matcher, constrained to the verified dataset. */
export function getPestIdentificationService(): PestIdentificationService {
  if (cachedPestService === null) {
    cachedPestService = new PestIdentificationService(getAiHarness());
  }
  return cachedPestService;
}

/** Search-grounded market price lookup (advisory display data only). */
export function getMarketPriceService(): MarketPriceService {
  if (cachedMarketService === null) {
    cachedMarketService = new MarketPriceService(getAiHarness());
  }
  return cachedMarketService;
}

/**
 * Snapshot for the status badge and the AI trace panel.
 *
 * `configured` means a key is present and AI is switched on. `live` is the stronger claim:
 * the next call would actually reach the model - the transport is usable, the device is
 * online, and the circuit breaker is closed. The two differ exactly when something is
 * temporarily wrong, which is the case the badge exists to show.
 */
export function getAiStatus(): {
  configured: boolean;
  live: boolean;
  modelId: string;
  transportId: string | null;
} {
  const config = getConfig();
  const transport = getTransport();
  let live = false;
  try {
    live = getAiHarness().isLive();
  } catch {
    live = false;
  }
  return {
    configured: isAiConfigured(config),
    live,
    modelId: config.modelChain[0] ?? "",
    transportId: transport ? transport.id : null,
  };
}

/**
 * Drop every singleton so the next accessor rebuilds from a fresh environment read.
 *
 * Tests call this in `beforeEach`/`afterEach`. It matters more than it looks: under vitest,
 * `import.meta.env` inherits the whole of `process.env` and also loads a root `.env`, so a
 * developer's real API key can be ambiently present. Resetting between cases keeps a test
 * that stubs the env from being contaminated by one that did not.
 */
export function resetAiSingletons(): void {
  cachedConfig = null;
  cachedTransport = null;
  transportResolved = false;
  cachedCache = null;
  cachedTelemetry = null;
  cachedHarness = null;
  cachedExplanationProvider = null;
  cachedSoilExtractor = null;
  cachedPestService = null;
  cachedMarketService = null;
}

/* ------------------------------------------------------------------------------------------
 * Re-exports. `export type` is mandatory here: `isolatedModules` is on, so a value-style
 * re-export of a type breaks the build.
 * ---------------------------------------------------------------------------------------- */

export type {
  AiCallRecord,
  AiErrorKind,
  AiOutcome,
  AiSourceKind,
  AiTaskDefinition,
  AiTaskId,
  AiTransport,
  GenerateOptions,
  InlineImage,
  PromptPayload,
  TransportResult,
} from "./contracts/aiTypes";
export { AiHarnessError, classifyError } from "./contracts/aiTypes";

export type {
  CalendarAnswer,
  ExplanationOutput,
  FarmAdvisorAnswer,
  MarketPrice,
  PestIdentification,
  SoilReportExtraction,
} from "./contracts/aiSchemas";
export {
  CalendarAnswerSchema,
  ExplanationOutputSchema,
  FarmAdvisorAnswerSchema,
  GEMINI_RESPONSE_SCHEMAS,
  MarketPriceSchema,
  PestIdentificationSchema,
  SoilReportExtractionSchema,
} from "./contracts/aiSchemas";

export type { HarnessConfig } from "./runtime/harnessConfig";
export {
  DEFAULT_MODEL_CHAIN,
  isAiConfigured,
  loadHarnessConfig,
} from "./runtime/harnessConfig";

export { AiHarness } from "./runtime/AiHarness";
export { HarnessTelemetry } from "./runtime/HarnessTelemetry";
export { ResponseCache } from "./runtime/ResponseCache";
export { selectTransport } from "./transport/selectTransport";

export { GeminiExplanationProvider, renderExplanation } from "./providers/GeminiExplanationProvider";
export {
  GeminiSoilReportExtractor,
  fileToInlineImage,
  toPartialProfile,
} from "./providers/GeminiSoilReportExtractor";
export { PestIdentificationService } from "./providers/PestIdentificationService";
export type { PestIdentificationOutcome } from "./providers/PestIdentificationService";
export { MarketPriceService } from "./providers/MarketPriceService";

export { createExplainRecommendationTask } from "./tasks/explainRecommendationTask";
export { createExtractSoilReportTask } from "./tasks/extractSoilReportTask";
export { createIdentifyPestTask } from "./tasks/identifyPestTask";
export { createMarketPriceTask } from "./tasks/marketPriceTask";
export { createAnswerCalendarQuestionTask } from "./tasks/answerCalendarQuestionTask";
export { createAnswerFarmQuestionTask } from "./tasks/answerFarmQuestionTask";

export type { ExplainRecommendationInput } from "./prompts/explainRecommendationPrompt";
export type { ExtractSoilReportInput } from "./prompts/extractSoilReportPrompt";
export type { IdentifyPestInput } from "./prompts/identifyPestPrompt";
export type { MarketPriceInput } from "./prompts/marketPricePrompt";
export type { AnswerCalendarQuestionInput } from "./prompts/answerCalendarQuestionPrompt";
export type { AnswerFarmQuestionInput } from "./prompts/answerFarmQuestionPrompt";

export { AntigravityAdkTransport } from "./transport/AntigravityAdkTransport";
export { ServerProxyTransport } from "./transport/ServerProxyTransport";
export {
  AntigravityAdkAgent,
  AgronomistExplainerAgent,
  SoilReportExtractorAgent,
  PestDiagnosticianAgent,
  MarketIntelligenceAgent,
  CalendarQueryAgent,
  GeneralFarmAdvisorAgent,
} from "./agents";
export type {
  AdkAgentConfig,
  AdkAgentStep,
  AdkAgentTool,
  AdkAgentTrajectory,
} from "./agents";

export { EXPLAIN_RECOMMENDATION_SYSTEM_PROMPT } from "./prompts/explainRecommendationPrompt";
export { EXTRACT_SOIL_REPORT_SYSTEM_PROMPT } from "./prompts/extractSoilReportPrompt";
export { IDENTIFY_PEST_SYSTEM_PROMPT } from "./prompts/identifyPestPrompt";
export { MARKET_PRICE_SYSTEM_PROMPT } from "./prompts/marketPricePrompt";
export { ANSWER_CALENDAR_QUESTION_SYSTEM_PROMPT } from "./prompts/answerCalendarQuestionPrompt";
export { ANSWER_FARM_QUESTION_SYSTEM_PROMPT } from "./prompts/answerFarmQuestionPrompt";
