/**
 * Core contracts for the Krishi Mitra AI harness.
 *
 * ARCHITECTURE RULE (non-negotiable): the deterministic engine layer (`src/engine/**`)
 * DECIDES; the AI layer only EXPLAINS and PERCEIVES. Nothing in this file may be used to
 * mutate a suitability score, ranking, financial number, or safety threshold, and no AI
 * output may originate chemical/pesticide dosing — that comes only from the verified
 * dataset (`src/data/sample/corrections.ts`, `src/data/sample/pests.ts`).
 *
 * This module is intentionally dependency-free apart from a *type-only* zod import, so it
 * can be imported from anywhere in the harness (transports, runtime, tasks, UI) without
 * creating cycles. It must never import from `./aiSchemas`.
 */

import type { ZodType } from "zod";
import type { A2AJsonSchema } from "../a2a/types";

/**
 * Closed set of AI-assisted jobs the harness knows how to run. Used as the telemetry
 * grouping key and as the key space for `GEMINI_RESPONSE_SCHEMAS`.
 */
export type AiTaskId =
  | "explain-recommendation"
  | "extract-soil-report"
  | "identify-pest"
  | "market-price"
  | "answer-calendar-question"
  | "answer-farm-question";

/**
 * Provenance of an `AiOutcome`, surfaced to the user so a model-generated answer is never
 * mistaken for a deterministic one.
 * - `gemini`: fresh live model response
 * - `local`: deterministic offline fallback (always safe, never degraded in correctness)
 * - `cache`: a previously validated live response replayed from storage
 * - `unavailable`: no result could be produced at all
 */
export type AiSourceKind = "gemini" | "local" | "cache" | "unavailable";

/**
 * A single image supplied to a multimodal prompt.
 *
 * `base64Data` MUST be the bare base64 payload with NO `data:<mime>;base64,` prefix —
 * that is the shape the Gemini `inlineData` part expects.
 */
export interface InlineImage {
  mimeType: string;
  base64Data: string;
}

/**
 * A single developer-defined tool the model may call instead of answering directly. Mirrors
 * Gemini's `functionDeclarations` shape. `parameters` reuses the same JSON-Schema shape the
 * A2A catalog already produces via `zodToJsonSchema.ts` — one schema representation for both
 * the human-readable agent catalog and the model-facing tool contract.
 */
export interface AiToolDeclaration {
  name: string;
  description: string;
  parameters: A2AJsonSchema;
}

/** One function call the model asked the caller to execute, with its (untyped) arguments. */
export interface AiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * A fully-built, transport-agnostic prompt. Produced by a task's `buildPrompt` and consumed
 * by any `AiTransport`. Keeping this plain lets the SDK and REST transports stay swappable.
 *
 * `useSearchGrounding` requests the Google Search grounding tool. Grounding cannot be
 * combined with JSON response-mime-type, so grounded tasks must ask for plain text and be
 * parsed defensively. `tools`, when present, requests developer-defined function-calling
 * instead — mutually exclusive with both `useSearchGrounding` and a JSON response schema on
 * the same call (a Gemini constraint every transport enforces identically).
 */
export interface PromptPayload {
  system: string;
  user: string;
  images?: InlineImage[];
  useSearchGrounding?: boolean;
  tools?: AiToolDeclaration[];
}

/**
 * The single result type every harness call resolves to. `AiHarness.run()` never rejects,
 * so callers branch on `source`/`degraded` rather than on try/catch.
 *
 * - `degraded`: true whenever the caller is looking at fallback output rather than a live
 *   validated model answer — the UI must say so.
 * - `validationRepaired`: true when the first model response failed schema validation and a
 *   single repair round produced a conforming one.
 * - `groundingUrls`: citation URIs from search grounding, for attribution.
 * - `notes`: human-readable trail (fallback reasons, retry causes) for the trace panel.
 */
export interface AiOutcome<T> {
  data: T;
  source: AiSourceKind;
  modelId?: string;
  latencyMs: number;
  degraded: boolean;
  validationRepaired: boolean;
  groundingUrls?: string[];
  notes: string[];
}

/**
 * Per-call knobs handed to a transport. `responseSchema` is the provider-shaped JSON schema
 * (see `GEMINI_RESPONSE_SCHEMAS`) and is deliberately `unknown` so this file stays free of
 * provider types.
 */
export interface GenerateOptions {
  responseSchema?: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Raw text a transport got back, plus the model that actually served it (which may be a
 * fallback further down the model chain) and any grounding citations. `functionCalls` is
 * populated only when the payload declared `tools` and the model chose to call one or more
 * instead of (or alongside) returning text.
 */
export interface TransportResult {
  text: string;
  modelId: string;
  groundingUrls?: string[];
  functionCalls?: AiFunctionCall[];
}

/**
 * The one seam every model backend implements: SDK, zero-dependency REST, or an in-memory
 * mock for tests. `isAvailable()` is a cheap synchronous check (key present, global `fetch`
 * present, SDK constructed) used to short-circuit to fallback without burning a round-trip.
 */
export interface AiTransport {
  readonly id: string;
  isAvailable(): boolean;
  generate(payload: PromptPayload, opts: GenerateOptions): Promise<TransportResult>;
}

/**
 * A self-contained unit of AI work. This is the harness's plug-in point: everything the
 * runtime needs to prompt, validate, cache, and — critically — survive without the model.
 *
 * `fallback` is mandatory by design. Every AI feature must have a deterministic answer, so
 * a missing key, an offline device, or a bad response degrades gracefully instead of
 * failing. `schema` is the trust boundary: unvalidated model output never escapes the
 * harness.
 */
export interface AiTaskDefinition<TInput, TOutput> {
  id: AiTaskId;
  label: string;
  buildPrompt(input: TInput): PromptPayload;
  schema: ZodType<TOutput>;
  geminiResponseSchema?: unknown;
  fallback(input: TInput): TOutput | Promise<TOutput>;
  cacheKey(input: TInput): string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  temperature?: number;
}

/**
 * One observed tool invocation. Today the only tool wired end-to-end is Google Search
 * grounding (`market-price`'s `useSearchGrounding`) — the shape is deliberately generic so a
 * future real function-calling loop can populate it identically without a schema change.
 */
export interface AiToolCallRecord {
  name: string;
  input?: unknown;
  output?: unknown;
  timestamp: string;
}

/**
 * What was actually (or would have been) sent to the model. Images are summarised — count and
 * mime types only — never inlined, so a soil-report or pest photo's base64 payload never bloats
 * the in-memory trace log.
 */
export interface AiRequestLog {
  system: string;
  user: string;
  imageCount: number;
  imageMimeTypes: string[];
  useSearchGrounding: boolean;
}

/** What came back: the raw transport text (absent if no live attempt was made) and the data actually returned to the caller — a validated live answer, a cache replay, or the deterministic fallback. */
export interface AiResponseLog {
  rawText?: string;
  parsedData: unknown;
  groundingUrls?: string[];
}

/**
 * One immutable telemetry row per `AiHarness.run()`, powering the AI trace panel so a judge
 * or farmer can see exactly what was asked, what answered, and whether it was degraded.
 * `sequence` is assigned by `HarnessTelemetry`, so recorders pass `Omit<AiCallRecord, "sequence">`.
 *
 * `notes` is the harness's full "thinking" trail for this call — cache hits, retry/backoff
 * decisions, repair attempts, fallback reasons — in the order they happened. `request` is
 * `undefined` only when `task.buildPrompt` itself threw (nothing could be constructed to show).
 */
export interface AiCallRecord {
  taskId: AiTaskId;
  label: string;
  source: AiSourceKind;
  modelId?: string;
  latencyMs: number;
  degraded: boolean;
  validationRepaired: boolean;
  ok: boolean;
  errorMessage?: string;
  attempts: number;
  sequence: number;
  notes: string[];
  request?: AiRequestLog;
  response: AiResponseLog;
  toolCalls: AiToolCallRecord[];
}

/**
 * Failure taxonomy that drives retry and circuit-breaker policy.
 * `network` / `rate-limit` / `timeout` are transient and retryable; `auth` and `validation`
 * are not (retrying a bad key or a bad schema just wastes the user's time and quota).
 */
export type AiErrorKind =
  | "network"
  | "auth"
  | "rate-limit"
  | "timeout"
  | "validation"
  | "unknown";

/**
 * The single error type the harness raises internally. Carries a classified `kind` so the
 * retry policy and circuit breaker can decide without string-matching, plus the originating
 * HTTP `status` when one exists.
 */
export class AiHarnessError extends Error {
  constructor(
    message: string,
    public readonly kind: AiErrorKind,
    public readonly status?: number
  ) {
    super(message);
    this.name = "AiHarnessError";
    // Preserve `instanceof` across the ES2020 down-level class emit.
    Object.setPrototypeOf(this, AiHarnessError.prototype);
  }
}

/** Safely read `.name` off an unknown throwable. */
function readErrorName(err: unknown): string {
  if (typeof err === "object" && err !== null) {
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

/** Safely read a human-readable message off an unknown throwable. */
function readErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  try {
    const text = String(err);
    return text.length > 0 ? text : "Unknown AI error";
  } catch {
    return "Unknown AI error";
  }
}

/** Structural zod detection — avoids a runtime dependency on zod in this module. */
function looksLikeZodError(err: unknown): boolean {
  if (readErrorName(err) === "ZodError") return true;
  if (typeof err === "object" && err !== null) {
    return Array.isArray((err as { issues?: unknown }).issues);
  }
  return false;
}

/** Abort/timeout detection across DOMException, Node, and undici shapes. */
function looksLikeAbort(err: unknown): boolean {
  const name = readErrorName(err);
  if (name === "AbortError" || name === "TimeoutError") return true;
  if (typeof err === "object" && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (code === "ABORT_ERR" || code === "ETIMEDOUT") return true;
  }
  return false;
}

/** Message-level fetch-failure detection (browsers, jsdom, and undici all word this differently). */
function looksLikeNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError || readErrorName(err) === "TypeError") return true;
  const message = readErrorMessage(err).toLowerCase();
  const needles = [
    "failed to fetch",
    "fetch failed",
    "networkerror",
    "network error",
    "network request failed",
    "load failed",
    "econnrefused",
    "econnreset",
    "enotfound",
    "socket hang up",
    "err_internet_disconnected",
  ];
  for (const needle of needles) {
    if (message.indexOf(needle) !== -1) return true;
  }
  return false;
}

/**
 * Normalises anything thrown anywhere in the harness into an `AiHarnessError` with a
 * retry-relevant `kind`. Total: never throws, accepts any value.
 *
 * Mapping: abort/timeout -> `timeout`; HTTP 401/403 -> `auth`; HTTP 429 -> `rate-limit`;
 * HTTP 5xx -> `network`; `TypeError`/fetch failure -> `network`; zod failure -> `validation`;
 * anything else -> `unknown`. An `AiHarnessError` passed in is returned unchanged so the
 * classification is idempotent through nested catch blocks.
 */
export function classifyError(err: unknown, status?: number): AiHarnessError {
  if (err instanceof AiHarnessError) return err;

  const message = readErrorMessage(err);

  // Aborts win over everything: a cancelled request has no meaningful status.
  if (looksLikeAbort(err)) {
    return new AiHarnessError(message, "timeout", status);
  }

  // An explicit HTTP status is the most reliable signal available.
  if (typeof status === "number" && Number.isFinite(status)) {
    if (status === 401 || status === 403) {
      return new AiHarnessError(message, "auth", status);
    }
    if (status === 429) {
      return new AiHarnessError(message, "rate-limit", status);
    }
    if (status >= 500 && status <= 599) {
      return new AiHarnessError(message, "network", status);
    }
  }

  if (looksLikeZodError(err)) {
    return new AiHarnessError(message, "validation", status);
  }

  if (looksLikeNetworkFailure(err)) {
    return new AiHarnessError(message, "network", status);
  }

  return new AiHarnessError(message, "unknown", status);
}
