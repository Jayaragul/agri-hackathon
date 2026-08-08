/**
 * `AiTransport` that calls THIS APP'S OWN backend (`server/src/routes/aiRoutes.ts`) instead of
 * Google's API directly. This is the secure production posture: `GEMINI_API_KEY` lives only in
 * the server's environment and never reaches the browser, unlike `GeminiSdkTransport` /
 * `GeminiRestTransport` / `AntigravityAdkTransport`, which all read a `VITE_`-prefixed key that
 * Vite inlines into the public JS bundle.
 *
 * Selected via `VITE_AI_TRANSPORT=server` — see `selectTransport.ts`. Availability does NOT
 * depend on any client-side key; it depends only on `fetch` existing and the backend being
 * reachable, which `generate()` discovers per-call rather than through a synchronous probe.
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

interface ProxyReply {
  text: string;
  modelId: string;
  groundingUrls?: string[];
  functionCalls?: AiFunctionCall[];
}

function normaliseTimeout(timeoutMs?: number): number {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return 20_000;
  return Math.min(timeoutMs, 120_000);
}

export class ServerProxyTransport implements AiTransport {
  readonly id = "server-proxy";

  private readonly config: HarnessConfig;
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch | null;

  constructor(config: HarnessConfig, apiBase = "") {
    this.config = config;
    this.apiBase = apiBase.replace(/\/$/, "");
    this.fetchImpl =
      typeof globalThis !== "undefined" && typeof globalThis.fetch === "function"
        ? globalThis.fetch.bind(globalThis)
        : null;
  }

  isAvailable(): boolean {
    return this.fetchImpl !== null;
  }

  async generate(payload: PromptPayload, opts: GenerateOptions): Promise<TransportResult> {
    if (this.fetchImpl === null) {
      throw new AiHarnessError("fetch is unavailable in this runtime.", "network");
    }

    const timeoutMs = normaliseTimeout(opts.timeoutMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = (): void => controller.abort();
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", onExternalAbort);
    }

    try {
      const response = await this.fetchImpl(`${this.apiBase}/api/ai/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          system: payload.system,
          user: payload.user,
          images: payload.images,
          useSearchGrounding: payload.useSearchGrounding,
          tools: payload.tools,
          modelChain: this.config.modelChain,
          temperature: opts.temperature,
          maxOutputTokens: opts.maxOutputTokens,
          responseSchema: opts.responseSchema,
          timeoutMs: opts.timeoutMs,
        }),
      });

      if (!response.ok) {
        let detail = "";
        try {
          const body = (await response.json()) as { error?: string };
          detail = body?.error ?? "";
        } catch {
          detail = "";
        }
        throw new AiHarnessError(
          `Server AI proxy failed with HTTP ${response.status}${detail ? `: ${detail}` : "."}`,
          response.status === 401 || response.status === 403
            ? "auth"
            : response.status === 429
            ? "rate-limit"
            : "network",
          response.status
        );
      }

      const reply = (await response.json()) as ProxyReply;
      const result: TransportResult = { text: reply.text, modelId: reply.modelId };
      if (reply.groundingUrls) result.groundingUrls = reply.groundingUrls;
      if (reply.functionCalls) result.functionCalls = reply.functionCalls;
      return result;
    } catch (err) {
      if (opts.signal?.aborted) throw new AiHarnessError("Agent run cancelled by caller.", "unknown");
      if (controller.signal.aborted) throw new AiHarnessError(`Server AI proxy timed out after ${timeoutMs}ms.`, "timeout");
      throw err instanceof AiHarnessError ? err : classifyError(err);
    } finally {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener("abort", onExternalAbort);
    }
  }
}
