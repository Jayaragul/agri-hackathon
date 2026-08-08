/**
 * Zero-dependency `AiTransport`: raw `fetch` against the Gemini v1beta REST endpoint.
 *
 * This exists as insurance. If the `@google/genai` SDK fails to load, gets tree-shaken oddly,
 * or breaks in a locked-down webview on a low-end handset, the harness can still reach the
 * model with nothing but `fetch`. Behaviour is intentionally identical to the SDK transport
 * (same model-chain walk, same timeout discipline, same grounding extraction, same error
 * classification) so swapping them is invisible to `AiHarness`.
 *
 * REST-specific detail worth keeping: the HTTP status is authoritative for classification, and
 * the response body carries the actual reason a call failed. We truncate the body into the
 * error message (~300 chars) because a bare "400 Bad Request" is undebuggable in the field.
 */

import { AiHarnessError, classifyError } from "../contracts/aiTypes";
import type {
  AiFunctionCall,
  AiTransport,
  GenerateOptions,
  PromptPayload,
  TransportResult,
} from "../contracts/aiTypes";
import type { HarnessConfig } from "../runtime/harnessConfig";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const FALLBACK_TIMEOUT_MS = 20_000;
const MAX_ERROR_BODY_CHARS = 300;

/** Request part: prompt text or a bare-base64 inline image. */
interface RestPart {
  text?: string;
  inlineData?: { data: string; mimeType: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
}

interface RestGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  responseSchema?: unknown;
}

interface RestRequestBody {
  contents: Array<{ role: string; parts: RestPart[] }>;
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: RestGenerationConfig;
  tools?: unknown[];
}

interface RestGroundingChunk {
  web?: { uri?: string; title?: string };
}

interface RestCandidate {
  content?: { parts?: RestPart[] };
  finishReason?: string;
  groundingMetadata?: {
    groundingChunks?: RestGroundingChunk[];
    webSearchQueries?: string[];
  };
}

interface RestResponseBody {
  candidates?: RestCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

/** Injection seam: tests supply a stub `fetch` instead of patching globals. */
export interface GeminiRestTransportDeps {
  fetchImpl?: typeof fetch;
}

function normaliseTimeout(timeoutMs: number): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return FALLBACK_TIMEOUT_MS;
  }
  return Math.min(timeoutMs, 120_000);
}

function readMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  try {
    return String(err);
  } catch {
    return "Unknown Gemini REST error";
  }
}

function truncate(text: string, limit: number): string {
  if (typeof text !== "string") return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/**
 * Carries the HTTP status alongside the failure so the chain walker can distinguish
 * "wrong model" (404) from "wrong key" (401) without re-parsing strings.
 */
class RestHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RestHttpError";
    this.status = status;
    Object.setPrototypeOf(this, RestHttpError.prototype);
  }
}

function extractStatus(err: unknown): number | undefined {
  if (err instanceof RestHttpError) return err.status;
  if (err instanceof AiHarnessError) return err.status;
  if (typeof err === "object" && err !== null) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number" && Number.isFinite(status)) return status;
  }
  return undefined;
}

/** Only a missing/unusable model id justifies advancing down the chain. */
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

function extractGroundingUrls(body: RestResponseBody): string[] | undefined {
  const chunks = body.candidates?.[0]?.groundingMetadata?.groundingChunks;
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

/** Concatenate every text part of the first candidate (a reply can be split across parts). */
function readResponseText(body: RestResponseBody): string {
  const parts = body.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";

  let assembled = "";
  for (const part of parts) {
    if (part && typeof part.text === "string") assembled += part.text;
  }
  return assembled;
}

/** Collect any `functionCall` parts off the first candidate — absent unless `tools` was sent. */
function extractFunctionCalls(body: RestResponseBody): AiFunctionCall[] | undefined {
  const parts = body.candidates?.[0]?.content?.parts;
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

function buildParts(payload: PromptPayload): RestPart[] {
  const parts: RestPart[] = [{ text: payload.user }];
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

export class GeminiRestTransport implements AiTransport {
  readonly id = "gemini-rest";

  private readonly config: HarnessConfig;
  private readonly fetchImpl: typeof fetch | null;
  private preferredModelId: string | null = null;

  constructor(config: HarnessConfig, deps?: GeminiRestTransportDeps) {
    this.config = config;
    const injected = deps?.fetchImpl;
    if (typeof injected === "function") {
      this.fetchImpl = injected;
    } else if (typeof globalThis !== "undefined" && typeof globalThis.fetch === "function") {
      // Bind so the global fetch keeps its illegal-invocation-free `this`.
      this.fetchImpl = globalThis.fetch.bind(globalThis);
    } else {
      this.fetchImpl = null;
    }
  }

  isAvailable(): boolean {
    return (
      this.fetchImpl !== null &&
      typeof this.config?.apiKey === "string" &&
      this.config.apiKey.trim().length > 0 &&
      Array.isArray(this.config.modelChain) &&
      this.config.modelChain.length > 0
    );
  }

  async generate(payload: PromptPayload, opts: GenerateOptions): Promise<TransportResult> {
    if (this.fetchImpl === null) {
      throw new AiHarnessError("fetch is unavailable in this runtime.", "network");
    }
    if (!this.isAvailable()) {
      throw new AiHarnessError("Gemini REST transport has no API key configured.", "auth");
    }

    const timeoutMs = normaliseTimeout(opts.timeoutMs);
    const controller = new AbortController();
    const onExternalAbort = (): void => {
      controller.abort();
    };

    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", onExternalAbort);
    }

    // Belt and braces: abort the fetch AND reject on our own timer, so a socket that never
    // honours the abort still cannot wedge the harness.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        try {
          controller.abort();
        } catch {
          // Best-effort; the rejection below is what unblocks the caller.
        }
        reject(
          new AiHarnessError(`Gemini REST request timed out after ${timeoutMs}ms.`, "timeout")
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

  private async runModelChain(
    payload: PromptPayload,
    opts: GenerateOptions,
    signal: AbortSignal
  ): Promise<TransportResult> {
    const chain = this.resolveChain();
    let lastError: unknown = new AiHarnessError(
      "Gemini REST transport has no model to call.",
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
          if (this.preferredModelId === modelId) this.preferredModelId = null;
          lastError = err;
          continue;
        }
        throw classifyError(err, status);
      }
    }

    throw classifyError(lastError, extractStatus(lastError));
  }

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

  private buildBody(payload: PromptPayload, opts: GenerateOptions): RestRequestBody {
    const body: RestRequestBody = {
      contents: [{ role: "user", parts: buildParts(payload) }],
    };

    if (typeof payload.system === "string" && payload.system.trim().length > 0) {
      body.systemInstruction = { parts: [{ text: payload.system }] };
    }

    const generationConfig: RestGenerationConfig = {};
    if (typeof opts.temperature === "number" && Number.isFinite(opts.temperature)) {
      generationConfig.temperature = opts.temperature;
    }
    if (typeof opts.maxOutputTokens === "number" && Number.isFinite(opts.maxOutputTokens)) {
      generationConfig.maxOutputTokens = opts.maxOutputTokens;
    }

    // NEVER more than one: JSON mode, googleSearch grounding, and developer-defined tools are
    // all mutually exclusive server-side.
    if (payload.useSearchGrounding === true) {
      body.tools = [{ googleSearch: {} }];
    } else if (Array.isArray(payload.tools) && payload.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: payload.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
      ];
    } else if (opts.responseSchema !== undefined && opts.responseSchema !== null) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = opts.responseSchema;
    }

    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }
    return body;
  }

  private async callModel(
    modelId: string,
    payload: PromptPayload,
    opts: GenerateOptions,
    signal: AbortSignal
  ): Promise<TransportResult> {
    const fetchImpl = this.fetchImpl;
    if (fetchImpl === null) {
      throw new AiHarnessError("fetch is unavailable in this runtime.", "network");
    }

    const url = `${API_BASE}/${encodeURIComponent(modelId)}:generateContent`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        // Header auth, never a query param — a key in a URL leaks through logs and referrers.
        "x-goog-api-key": this.config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(this.buildBody(payload, opts)),
      signal,
    });

    const status = typeof response?.status === "number" ? response.status : 0;

    if (!response || response.ok !== true) {
      let detail = "";
      try {
        detail = truncate(await response.text(), MAX_ERROR_BODY_CHARS);
      } catch {
        detail = "";
      }
      throw new RestHttpError(
        `Gemini REST ${modelId} failed with HTTP ${status}${detail ? `: ${detail}` : "."}`,
        status
      );
    }

    let body: RestResponseBody;
    try {
      body = (await response.json()) as RestResponseBody;
    } catch (err) {
      throw new AiHarnessError(
        `Gemini REST ${modelId} returned unparseable JSON: ${readMessage(err)}`,
        "unknown",
        status
      );
    }

    // A 200 can still carry an error envelope (and a 404-in-body for a dead model id).
    if (body?.error) {
      throw new RestHttpError(
        `Gemini REST ${modelId} error: ${truncate(
          body.error.message ?? body.error.status ?? "unknown",
          MAX_ERROR_BODY_CHARS
        )}`,
        typeof body.error.code === "number" ? body.error.code : status
      );
    }

    const text = readResponseText(body);
    const functionCalls = extractFunctionCalls(body);
    if (text.trim().length === 0 && !functionCalls) {
      const finishReason = body.candidates?.[0]?.finishReason;
      const blockReason = body.promptFeedback?.blockReason;
      const reason = finishReason ?? blockReason;
      throw new AiHarnessError(
        `Gemini REST ${modelId} returned an empty response${reason ? ` (${reason})` : ""}.`,
        "unknown",
        status
      );
    }

    const groundingUrls = extractGroundingUrls(body);
    const result: TransportResult = { text, modelId };
    if (groundingUrls) result.groundingUrls = groundingUrls;
    if (functionCalls) result.functionCalls = functionCalls;
    return result;
  }
}
