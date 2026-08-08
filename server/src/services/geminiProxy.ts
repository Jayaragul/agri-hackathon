/**
 * Server-side Gemini proxy. This is what `GEMINI_API_KEY` protects: the key is read from the
 * server's own environment (never a `VITE_`-prefixed variable, never sent to or read by the
 * browser) and every model call happens here. The frontend's `ServerProxyTransport` only ever
 * talks to this server's own `/api/ai/generate` route — it never sees the key.
 *
 * Mirrors the request/response shape of `src/services/ai/transport/GeminiRestTransport.ts` on
 * the frontend closely enough that swapping a client-direct transport for this proxy is
 * invisible to `AiHarness`: same model-chain walk, same grounding extraction, same classified
 * failure reasons.
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_ERROR_BODY_CHARS = 300;

export interface ProxyImage {
  mimeType: string;
  base64Data: string;
}

/** Mirrors `src/services/ai/contracts/aiTypes.ts`'s `AiToolDeclaration`/`AiFunctionCall` — this
 * server has no dependency on the frontend source tree, so the shapes are duplicated rather
 * than imported. */
export interface ProxyToolDeclaration {
  name: string;
  description: string;
  parameters?: unknown;
}

export interface ProxyFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

export interface GenerateRequest {
  system?: string;
  user: string;
  images?: ProxyImage[];
  useSearchGrounding?: boolean;
  tools?: ProxyToolDeclaration[];
  modelChain: string[];
  temperature?: number;
  maxOutputTokens?: number;
  responseSchema?: unknown;
  timeoutMs?: number;
}

export interface GenerateReply {
  text: string;
  modelId: string;
  groundingUrls?: string[];
  functionCalls?: ProxyFunctionCall[];
}

export class ProxyError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ProxyError";
  }
}

interface RestPart {
  text?: string;
  inlineData?: { data: string; mimeType: string };
  functionCall?: { name: string; args?: Record<string, unknown> };
}

interface RestCandidate {
  content?: { parts?: RestPart[] };
  finishReason?: string;
  groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string } }> };
}

interface RestResponseBody {
  candidates?: RestCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function buildParts(request: GenerateRequest): RestPart[] {
  const parts: RestPart[] = [{ text: request.user }];
  for (const image of request.images ?? []) {
    if (!image?.base64Data) continue;
    parts.push({ inlineData: { data: image.base64Data, mimeType: image.mimeType || "image/jpeg" } });
  }
  return parts;
}

function extractGroundingUrls(body: RestResponseBody): string[] | undefined {
  const chunks = body.candidates?.[0]?.groundingMetadata?.groundingChunks;
  if (!Array.isArray(chunks)) return undefined;
  const urls = chunks.map((c) => c.web?.uri).filter((uri): uri is string => typeof uri === "string" && uri.length > 0);
  return urls.length > 0 ? Array.from(new Set(urls)) : undefined;
}

function readResponseText(body: RestResponseBody): string {
  const parts = body.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
}

function extractFunctionCalls(body: RestResponseBody): ProxyFunctionCall[] | undefined {
  const parts = body.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return undefined;

  const calls: ProxyFunctionCall[] = [];
  for (const part of parts) {
    const call = part?.functionCall;
    if (call && typeof call.name === "string" && call.name.length > 0) {
      calls.push({ name: call.name, args: call.args ?? {} });
    }
  }
  return calls.length > 0 ? calls : undefined;
}

async function callModel(
  apiKey: string,
  modelId: string,
  request: GenerateRequest,
  signal: AbortSignal,
  fetchImpl: typeof fetch
): Promise<GenerateReply> {
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: buildParts(request) }],
  };
  if (request.system) body.systemInstruction = { parts: [{ text: request.system }] };

  const generationConfig: Record<string, unknown> = {};
  if (typeof request.temperature === "number") generationConfig.temperature = request.temperature;
  if (typeof request.maxOutputTokens === "number") generationConfig.maxOutputTokens = request.maxOutputTokens;

  if (request.useSearchGrounding) {
    body.tools = [{ googleSearch: {} }];
  } else if (Array.isArray(request.tools) && request.tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      },
    ];
  } else if (request.responseSchema !== undefined && request.responseSchema !== null) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = request.responseSchema;
  }
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

  const response = await fetchImpl(`${API_BASE}/${encodeURIComponent(modelId)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  const status = response.status;
  if (!response.ok) {
    const detail = truncate(await response.text().catch(() => ""), MAX_ERROR_BODY_CHARS);
    throw new ProxyError(status, `Gemini ${modelId} failed with HTTP ${status}${detail ? `: ${detail}` : "."}`);
  }

  const payload = (await response.json()) as RestResponseBody;
  if (payload.error) {
    throw new ProxyError(
      typeof payload.error.code === "number" ? payload.error.code : status,
      truncate(payload.error.message ?? "Gemini returned an error.", MAX_ERROR_BODY_CHARS)
    );
  }

  const text = readResponseText(payload);
  const functionCalls = extractFunctionCalls(payload);
  if (text.trim().length === 0 && !functionCalls) {
    const reason = payload.candidates?.[0]?.finishReason ?? payload.promptFeedback?.blockReason;
    throw new ProxyError(502, `Gemini ${modelId} returned an empty response${reason ? ` (${reason})` : ""}.`);
  }

  const groundingUrls = extractGroundingUrls(payload);
  const reply: GenerateReply = { text, modelId };
  if (groundingUrls) reply.groundingUrls = groundingUrls;
  if (functionCalls) reply.functionCalls = functionCalls;
  return reply;
}

/**
 * Walk `request.modelChain` in order, returning the first success. A 404/"not found"-shaped
 * failure advances to the next model; anything else (auth, rate-limit, a real server error)
 * stops the chain immediately, matching `GeminiRestTransport`'s client-side behaviour.
 */
export async function generateViaGemini(
  apiKey: string,
  request: GenerateRequest,
  fetchImpl: typeof fetch = fetch
): Promise<GenerateReply> {
  if (!apiKey) throw new ProxyError(503, "Gemini is not configured on the server (GEMINI_API_KEY is unset).");
  if (!request.user?.trim()) throw new ProxyError(400, "A prompt is required.");
  if (!Array.isArray(request.modelChain) || request.modelChain.length === 0) {
    throw new ProxyError(400, "A model chain is required.");
  }

  const timeoutMs = Math.min(120_000, Math.max(1_000, request.timeoutMs ?? 20_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let lastError: unknown = new ProxyError(502, "No model in the chain could be reached.");
    for (const modelId of request.modelChain) {
      try {
        return await callModel(apiKey, modelId, request, controller.signal, fetchImpl);
      } catch (err) {
        const status = err instanceof ProxyError ? err.status : 0;
        const message = err instanceof Error ? err.message.toLowerCase() : "";
        const looksLikeMissingModel = status === 404 || message.includes("not found") || message.includes("not_found");
        lastError = err;
        if (!looksLikeMissingModel) throw err;
      }
    }
    throw lastError;
  } catch (err) {
    if (err instanceof ProxyError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new ProxyError(504, `Gemini took too long to respond (over ${timeoutMs}ms).`);
    }
    throw new ProxyError(502, err instanceof Error ? err.message : "Could not reach Gemini.");
  } finally {
    clearTimeout(timer);
  }
}
