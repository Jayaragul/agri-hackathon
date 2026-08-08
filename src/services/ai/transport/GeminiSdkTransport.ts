/**
 * `AiTransport` backed by the official `@google/genai` SDK (v2.16.0, browser build).
 *
 * Responsibilities are deliberately narrow: turn a `PromptPayload` into one Gemini call and
 * hand back raw text. It does NOT parse, validate, cache, retry, or interpret — that is
 * `AiHarness`'s job. It never decides anything: per the architecture rule the deterministic
 * engine decides, the AI layer only explains and perceives.
 *
 * Two behaviours are load-bearing and easy to get wrong:
 *  1. MODEL CHAIN. A model id can vanish (deprecation, region gating) and the API answers 404.
 *     We walk `config.modelChain` on 404/NOT_FOUND only, and remember the first model that
 *     worked so later calls stop re-probing dead ids.
 *  2. TIMEOUT. `config.abortSignal` alone is not enough — if the SDK's promise never settles
 *     the abort buys us nothing. We wire the signal AND race a timer, so a hung call always
 *     rejects. The timer is cleared in `finally`, so nothing leaks.
 *
 * The SDK is imported for its constructor only; the request/response surface is typed
 * structurally below. That keeps this file compiling regardless of which `.d.ts` the export
 * map resolves to, and lets tests inject a fake client with no SDK involvement.
 */

import { GoogleGenAI } from "@google/genai";

import { AiHarnessError, classifyError } from "../contracts/aiTypes";
import type {
  AiFunctionCall,
  AiTransport,
  GenerateOptions,
  PromptPayload,
  TransportResult,
} from "../contracts/aiTypes";
import type { HarnessConfig } from "../runtime/harnessConfig";

/** A single request/response part. `inlineData.data` is bare base64 (no data: URI prefix). */
interface GenAiPart {
  text?: string;
  inlineData?: { data: string; mimeType: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
}

interface GenAiContent {
  role: string;
  parts: GenAiPart[];
}

/**
 * The subset of `GenerateContentConfig` this transport sets.
 *
 * INVARIANT: `responseSchema` and `tools` (search grounding) are mutually exclusive —
 * Gemini rejects JSON mode combined with the googleSearch tool.
 */
interface GenAiRequestConfig {
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  responseMimeType?: string;
  responseSchema?: unknown;
  tools?: unknown[];
}

interface GenAiRequest {
  model: string;
  contents: GenAiContent[];
  config?: GenAiRequestConfig;
}

interface GenAiGroundingChunk {
  web?: { uri?: string; title?: string };
}

interface GenAiCandidate {
  content?: { parts?: GenAiPart[] };
  finishReason?: string;
  groundingMetadata?: {
    groundingChunks?: GenAiGroundingChunk[];
    webSearchQueries?: string[];
  };
}

/**
 * Structural view of the SDK response. `text` is a GETTER on the real class and may be
 * `undefined` (blocked content, MAX_TOKENS, thought-only parts) — never assume a string.
 */
interface GenAiResponse {
  text?: string;
  candidates?: GenAiCandidate[];
}

/** The one method this transport needs. Implement it to inject a fake client in tests. */
export interface GeminiSdkClientLike {
  models: {
    generateContent(request: GenAiRequest): Promise<GenAiResponse>;
  };
}

/** Injection seam so unit tests never construct a real SDK client or touch the network. */
export interface GeminiSdkTransportDeps {
  createClient?: (apiKey: string) => GeminiSdkClientLike;
}

const FALLBACK_TIMEOUT_MS = 20_000;

/** Guard against a nonsense timeout reaching `setTimeout`. */
function normaliseTimeout(timeoutMs: number): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return FALLBACK_TIMEOUT_MS;
  }
  return Math.min(timeoutMs, 120_000);
}

/** Read a message off any throwable without ever throwing itself. */
function readMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  try {
    return String(err);
  } catch {
    return "Unknown Gemini SDK error";
  }
}

/** Accept a numeric HTTP status from a number or a numeric string. */
function coerceStatus(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 100 && parsed <= 599) return parsed;
  }
  return undefined;
}

/**
 * Dig an HTTP status out of whatever the SDK threw. `ApiError` exposes `.status`, but nested
 * `{ error: { code } }` payloads and status-bearing message strings both show up in practice.
 */
function extractStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const candidate = err as {
    status?: unknown;
    code?: unknown;
    response?: { status?: unknown };
    error?: { code?: unknown; status?: unknown };
  };

  const direct =
    coerceStatus(candidate.status) ??
    coerceStatus(candidate.code) ??
    coerceStatus(candidate.response?.status) ??
    coerceStatus(candidate.error?.code);
  if (direct !== undefined) return direct;

  const match = /(?:"code"\s*:\s*|\bstatus\b\D{0,12})(\d{3})/i.exec(readMessage(err));
  if (match) return coerceStatus(match[1]);
  return undefined;
}

/**
 * True when the failure is "this model id does not exist / is not usable here", the only
 * condition that justifies advancing down the model chain. A false positive merely costs one
 * extra attempt against the next model, so this errs generous.
 */
function looksLikeModelNotFound(err: unknown, status?: number): boolean {
  if (status === 404) return true;
  const message = readMessage(err).toLowerCase();
  return (
    message.indexOf("not_found") !== -1 ||
    message.indexOf("not found") !== -1 ||
    message.indexOf("is not supported for generatecontent") !== -1 ||
    message.indexOf("unsupported model") !== -1 ||
    message.indexOf("unknown model") !== -1
  );
}

/** Collect deduped web citation URIs from grounding metadata; tolerant of every field missing. */
function extractGroundingUrls(response: GenAiResponse): string[] | undefined {
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks) || chunks.length === 0) return undefined;

  const urls: string[] = [];
  for (const chunk of chunks) {
    const uri = chunk?.web?.uri;
    if (typeof uri === "string" && uri.length > 0 && urls.indexOf(uri) === -1) {
      urls.push(uri);
    }
  }
  return urls.length > 0 ? urls : undefined;
}

/** Collect any `functionCall` parts off the first candidate — absent unless `tools` was set. */
function extractFunctionCalls(response: GenAiResponse): AiFunctionCall[] | undefined {
  const parts = response.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return undefined;

  const calls: AiFunctionCall[] = [];
  for (const part of parts) {
    const call = part?.functionCall;
    if (call && typeof call.name === "string" && call.name.length > 0) {
      calls.push({ name: call.name, args: call.args ?? {} });
    }
  }
  return calls.length > 0 ? calls : undefined;
}

/**
 * Resolve response text. `response.text` is a getter that may be undefined or may throw on an
 * odd payload, so fall back to concatenating the candidate's text parts by hand.
 */
function readResponseText(response: GenAiResponse): string {
  try {
    const direct = response.text;
    if (typeof direct === "string" && direct.trim().length > 0) return direct;
  } catch {
    // Getter threw — fall through to manual assembly.
  }

  const parts = response.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  let assembled = "";
  for (const part of parts) {
    if (part && typeof part.text === "string") assembled += part.text;
  }
  return assembled;
}

/** Build the `parts` array: prompt text first, then any inline images. */
function buildParts(payload: PromptPayload): GenAiPart[] {
  const parts: GenAiPart[] = [{ text: payload.user }];
  if (Array.isArray(payload.images)) {
    for (const image of payload.images) {
      if (!image || typeof image.base64Data !== "string" || image.base64Data.length === 0) {
        continue;
      }
      parts.push({
        inlineData: {
          data: image.base64Data,
          mimeType: image.mimeType || "image/jpeg",
        },
      });
    }
  }
  return parts;
}

export class GeminiSdkTransport implements AiTransport {
  readonly id = "gemini-sdk";

  private readonly config: HarnessConfig;
  private readonly createClient: (apiKey: string) => GeminiSdkClientLike;
  private client: GeminiSdkClientLike | null = null;
  /** The last model id that actually answered, hoisted to the front of the next chain walk. */
  private preferredModelId: string | null = null;

  constructor(config: HarnessConfig, deps?: GeminiSdkTransportDeps) {
    this.config = config;
    this.createClient =
      deps?.createClient ??
      ((apiKey: string): GeminiSdkClientLike =>
        new GoogleGenAI({ apiKey }) as unknown as GeminiSdkClientLike);
  }

  /** Cheap synchronous precondition check so the harness can skip a doomed round-trip. */
  isAvailable(): boolean {
    return (
      typeof this.config?.apiKey === "string" &&
      this.config.apiKey.trim().length > 0 &&
      Array.isArray(this.config.modelChain) &&
      this.config.modelChain.length > 0
    );
  }

  /**
   * One prompt in, raw text out. Rejects with `AiHarnessError` (never a bare SDK error) so the
   * retry policy and circuit breaker can classify without string matching.
   */
  async generate(payload: PromptPayload, opts: GenerateOptions): Promise<TransportResult> {
    if (!this.isAvailable()) {
      throw new AiHarnessError("Gemini SDK transport has no API key configured.", "auth");
    }

    const timeoutMs = normaliseTimeout(opts.timeoutMs);
    const controller = new AbortController();
    const onExternalAbort = (): void => {
      controller.abort();
    };

    // The caller's signal cancels us; our own timer is the backstop for a promise that never
    // settles (an abort the SDK ignores would otherwise hang the whole harness).
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", onExternalAbort);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        try {
          controller.abort();
        } catch {
          // Aborting is best-effort; the rejection below is what actually unblocks us.
        }
        reject(
          new AiHarnessError(`Gemini SDK request timed out after ${timeoutMs}ms.`, "timeout")
        );
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        this.runModelChain(payload, opts, controller.signal),
        timeoutPromise,
      ]);
    } catch (err) {
      throw classifyError(err, extractStatus(err));
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener("abort", onExternalAbort);
    }
  }

  /**
   * Try each model in preference order. Advance ONLY on model-not-found; every other failure
   * is a real failure and propagates immediately (retrying a 401 against a second model just
   * burns the user's time).
   */
  private async runModelChain(
    payload: PromptPayload,
    opts: GenerateOptions,
    signal: AbortSignal
  ): Promise<TransportResult> {
    const chain = this.resolveChain();
    let lastError: unknown = new AiHarnessError(
      "Gemini SDK transport has no model to call.",
      "unknown"
    );

    for (const modelId of chain) {
      try {
        const result = await this.callModel(modelId, payload, opts, signal);
        this.preferredModelId = modelId;
        return result;
      } catch (err) {
        const status = extractStatus(err);
        if (looksLikeModelNotFound(err, status)) {
          // Dead id — forget it if it was our remembered favourite, then try the next one.
          if (this.preferredModelId === modelId) this.preferredModelId = null;
          lastError = err;
          continue;
        }
        throw classifyError(err, status);
      }
    }

    throw classifyError(lastError, extractStatus(lastError));
  }

  /** Remembered-working model first, then the configured chain, deduped. */
  private resolveChain(): string[] {
    const chain: string[] = [];
    const push = (id: unknown): void => {
      if (typeof id === "string" && id.trim().length > 0 && chain.indexOf(id) === -1) {
        chain.push(id);
      }
    };
    push(this.preferredModelId);
    if (Array.isArray(this.config.modelChain)) {
      for (const id of this.config.modelChain) push(id);
    }
    return chain;
  }

  /** Lazily construct the SDK client — never at module load, never when AI is unconfigured. */
  private getClient(): GeminiSdkClientLike {
    if (this.client === null) {
      this.client = this.createClient(this.config.apiKey);
    }
    return this.client;
  }

  private async callModel(
    modelId: string,
    payload: PromptPayload,
    opts: GenerateOptions,
    signal: AbortSignal
  ): Promise<TransportResult> {
    const config: GenAiRequestConfig = { abortSignal: signal };

    if (typeof payload.system === "string" && payload.system.trim().length > 0) {
      config.systemInstruction = payload.system;
    }
    if (typeof opts.temperature === "number" && Number.isFinite(opts.temperature)) {
      config.temperature = opts.temperature;
    }
    if (typeof opts.maxOutputTokens === "number" && Number.isFinite(opts.maxOutputTokens)) {
      config.maxOutputTokens = opts.maxOutputTokens;
    }

    // MUTUALLY EXCLUSIVE: googleSearch grounding, developer-defined tools, and JSON response
    // mode cannot coexist on the same call — a tool-declaring call always returns prose or a
    // function call, never schema-shaped JSON.
    if (payload.useSearchGrounding === true) {
      config.tools = [{ googleSearch: {} }];
    } else if (Array.isArray(payload.tools) && payload.tools.length > 0) {
      config.tools = [
        {
          functionDeclarations: payload.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
      ];
    } else if (opts.responseSchema !== undefined && opts.responseSchema !== null) {
      config.responseMimeType = "application/json";
      config.responseSchema = opts.responseSchema;
    }

    const response = await this.getClient().models.generateContent({
      model: modelId,
      contents: [{ role: "user", parts: buildParts(payload) }],
      config,
    });

    const text = readResponseText(response);
    const functionCalls = extractFunctionCalls(response);
    if (text.trim().length === 0 && !functionCalls) {
      const finishReason = response.candidates?.[0]?.finishReason;
      throw new AiHarnessError(
        `Gemini returned an empty response from ${modelId}${
          finishReason ? ` (finishReason: ${finishReason})` : ""
        }.`,
        "unknown"
      );
    }

    const groundingUrls = extractGroundingUrls(response);
    const result: TransportResult = { text, modelId };
    if (groundingUrls) result.groundingUrls = groundingUrls;
    if (functionCalls) result.functionCalls = functionCalls;
    return result;
  }
}
