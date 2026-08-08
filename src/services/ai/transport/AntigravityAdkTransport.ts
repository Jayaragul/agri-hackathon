/**
 * Antigravity ADK Agent Transport.
 *
 * Implements `AiTransport` using the Google Antigravity Agent Development Kit (ADK)
 * agentic architecture. Provides tool routing, model fallback chains, search grounding,
 * structured JSON enforcement, and robust error classification.
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

interface AdkPart {
  text?: string;
  inlineData?: { data: string; mimeType: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
}

interface AdkGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  responseSchema?: unknown;
}

interface AdkRequestBody {
  contents: Array<{ role: string; parts: AdkPart[] }>;
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: AdkGenerationConfig;
  tools?: unknown[];
}

interface AdkCandidate {
  content?: { parts?: AdkPart[] };
  finishReason?: string;
  groundingMetadata?: {
    groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    webSearchQueries?: string[];
  };
}

interface AdkResponse {
  candidates?: AdkCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

function normaliseTimeout(timeoutMs?: number): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return FALLBACK_TIMEOUT_MS;
  }
  return Math.min(timeoutMs, 120_000);
}

function extractFunctionCalls(candidate?: AdkCandidate): AiFunctionCall[] | undefined {
  const parts = candidate?.content?.parts;
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

function extractGroundingUrls(candidate?: AdkCandidate): string[] | undefined {
  const chunks = candidate?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks) || chunks.length === 0) return undefined;

  const urls: string[] = [];
  for (const chunk of chunks) {
    const uri = chunk.web?.uri;
    if (typeof uri === "string" && uri.length > 0 && urls.indexOf(uri) === -1) {
      urls.push(uri);
    }
  }
  return urls.length > 0 ? urls : undefined;
}

export class AntigravityAdkTransport implements AiTransport {
  public readonly id = "antigravity-adk";
  private readonly config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.config = config;
  }

  public isAvailable(): boolean {
    return Boolean(
      this.config.enabled &&
      this.config.apiKey &&
      this.config.modelChain.length > 0
    );
  }

  public async generate(
    payload: PromptPayload,
    options: GenerateOptions
  ): Promise<TransportResult> {
    if (!this.isAvailable()) {
      throw new AiHarnessError(
        "Antigravity ADK transport is not configured with an API key.",
        "auth"
      );
    }

    const models = this.config.modelChain;
    let lastError: unknown = null;

    for (const model of models) {
      try {
        return await this.callModel(model, payload, options);
      } catch (err) {
        lastError = err;
        const classified =
          err instanceof AiHarnessError ? err : classifyError(err);

        // Auth or Validation errors cannot be recovered by cycling models
        if (classified.kind === "auth" || classified.kind === "validation") {
          throw classified;
        }

        // Advance to next model on transient model or rate errors
      }
    }

    throw (
      lastError instanceof AiHarnessError
        ? lastError
        : classifyError(lastError ?? new Error("All Antigravity ADK models failed."))
    );
  }

  private async callModel(
    model: string,
    payload: PromptPayload,
    options: GenerateOptions
  ): Promise<TransportResult> {
    const timeoutMs = normaliseTimeout(options.timeoutMs ?? this.config.timeoutMs);

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

    const onExternalAbort = () => timeoutController.abort();
    if (options.signal) {
      if (options.signal.aborted) {
        clearTimeout(timer);
        throw new AiHarnessError("Agent run cancelled by caller.", "unknown");
      }
      options.signal.addEventListener("abort", onExternalAbort);
    }

    try {
      const url = `${API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(
        this.config.apiKey
      )}`;

      const body: AdkRequestBody = {
        contents: [
          {
            role: "user",
            parts: this.buildParts(payload),
          },
        ],
      };

      if (payload.system) {
        body.systemInstruction = {
          parts: [{ text: payload.system }],
        };
      }

      const genConfig: AdkGenerationConfig = {};
      if (options.temperature !== undefined) {
        genConfig.temperature = options.temperature;
      }
      if (options.maxOutputTokens !== undefined) {
        genConfig.maxOutputTokens = options.maxOutputTokens;
      }

      if (payload.useSearchGrounding) {
        body.tools = [{ googleSearch: {} }];
      } else if (payload.tools && payload.tools.length > 0) {
        body.tools = [
          {
            functionDeclarations: payload.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
          },
        ];
      } else if (options.responseSchema) {
        genConfig.responseMimeType = "application/json";
        genConfig.responseSchema = options.responseSchema;
      }

      if (Object.keys(genConfig).length > 0) {
        body.generationConfig = genConfig;
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: timeoutController.signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        const truncated = errorText.slice(0, MAX_ERROR_BODY_CHARS);
        const kind =
          res.status === 429 ? "rate-limit" : res.status === 401 || res.status === 403 ? "auth" : "network";
        throw new AiHarnessError(
          `Antigravity ADK HTTP ${res.status}: ${truncated || res.statusText}`,
          kind,
          res.status
        );
      }

      const data: AdkResponse = await res.json();
      if (data.error) {
        const kind = data.error.code === 429 ? "rate-limit" : "network";
        throw new AiHarnessError(
          `Antigravity ADK error: ${data.error.message ?? "Unknown error"}`,
          kind,
          data.error.code
        );
      }

      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      const groundingUrls = extractGroundingUrls(candidate);
      const functionCalls = extractFunctionCalls(candidate);

      const result: TransportResult = { text, modelId: model };
      if (groundingUrls) result.groundingUrls = groundingUrls;
      if (functionCalls) result.functionCalls = functionCalls;
      return result;
    } catch (err) {
      if (options.signal?.aborted) {
        throw new AiHarnessError("Agent run cancelled by caller.", "unknown");
      }
      if (timeoutController.signal.aborted) {
        throw new AiHarnessError(`Antigravity ADK timed out after ${timeoutMs}ms.`, "timeout");
      }
      throw err instanceof AiHarnessError ? err : classifyError(err);
    } finally {
      clearTimeout(timer);
      if (options.signal) {
        options.signal.removeEventListener("abort", onExternalAbort);
      }
    }
  }

  private buildParts(payload: PromptPayload): AdkPart[] {
    const parts: AdkPart[] = [];
    if (payload.images) {
      for (const img of payload.images) {
        parts.push({
          inlineData: {
            data: img.base64Data,
            mimeType: img.mimeType,
          },
        });
      }
    }
    parts.push({ text: payload.user });
    return parts;
  }
}
