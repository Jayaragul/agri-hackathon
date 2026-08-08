/**
 * `AiHarness` — the runtime orchestrator. Every AI-assisted feature in the app goes through
 * `run()`, and nothing else in the codebase is allowed to call a model directly.
 *
 * ARCHITECTURE RULE (non-negotiable): the deterministic engine layer (`src/engine/**`) DECIDES;
 * this layer only EXPLAINS and PERCEIVES. The harness enforces that structurally — a task's
 * output is confined to its zod `schema`, and every task must supply a deterministic
 * `fallback()`, so the app is fully functional with the model switched off. Nothing here may be
 * used to alter a suitability score, ranking, financial number, safety threshold, or chemical
 * dose.
 *
 * THE ONE CONTRACT THAT MATTERS: **`run()` never rejects.** Whatever happens — no key, offline,
 * DNS failure, 500, abort, truncated JSON, schema violation, a task whose own `fallback()`
 * throws — it always resolves to an `AiOutcome`, and it always writes exactly one telemetry
 * record. Callers branch on `source` / `degraded`, never on try/catch.
 *
 * Decision table for `run()` (first match wins):
 *
 *   1. fresh cache entry that still validates      -> source "cache",       degraded false
 *   2. any gate closed (disabled / no transport /
 *      transport unavailable / offline / breaker
 *      open)                                       -> fallback -> "local",  degraded true
 *   3. live attempt loop succeeds                  -> source "gemini",      degraded false
 *      (a single schema-repair re-prompt may be
 *       used; sets validationRepaired)
 *   4. every attempt failed                        -> fallback -> "local",  degraded true
 *   5. fallback itself threw                       -> source "unavailable", degraded true
 */

import {
  classifyError,
  type AiCallRecord,
  type AiHarnessError,
  type AiOutcome,
  type AiRequestLog,
  type AiSourceKind,
  type AiTaskDefinition,
  type AiToolCallRecord,
  type AiTransport,
  type GenerateOptions,
  type PromptPayload,
} from "../contracts/aiTypes";
import type { HarnessConfig } from "./harnessConfig";
import { CircuitBreaker } from "./CircuitBreaker";
import { HarnessTelemetry } from "./HarnessTelemetry";
import { ResponseCache } from "./ResponseCache";
import { computeBackoffMs, isRetryable } from "./RetryPolicy";

// ---------------------------------------------------------------------------
// JSON extraction (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Strip a Markdown code fence from a model response.
 *
 * Models wrap JSON in ```json … ``` roughly half the time, and grounded responses (which cannot
 * use JSON mode at all) do it even more. Prefers the contents of the first fenced block; falls
 * back to the original text when there is no complete fence.
 */
export function stripCodeFences(raw: string): string {
  if (typeof raw !== "string") return "";
  const fenced = /```[ \t]*([a-zA-Z0-9_+-]*)[ \t]*\r?\n?([\s\S]*?)```/.exec(raw);
  if (fenced && typeof fenced[2] === "string" && fenced[2].trim().length > 0) {
    return fenced[2].trim();
  }
  // An unterminated opening fence (truncated output) — drop the fence marker line.
  return raw.replace(/^\s*```[ \t]*[a-zA-Z0-9_+-]*[ \t]*\r?\n?/, "").trim();
}

/** Maximum candidate start positions scanned, bounding worst-case work on adversarial text. */
const MAX_JSON_SCAN_CANDIDATES = 24;

/**
 * Extract the first *balanced* top-level JSON object or array from arbitrary model prose.
 *
 * Deliberately NOT `indexOf("{")` + `lastIndexOf("}")`: that breaks the moment a model emits a
 * closing brace inside a string (`"note": "use 2:1 ratio }"`), appends a second object, or adds
 * a trailing sentence. This scans with proper string and escape awareness and returns the first
 * substring that actually closes.
 *
 * @returns The JSON substring, or `null` when nothing balanced was found.
 */
export function extractJsonBlock(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const text = stripCodeFences(raw);
  if (text.length === 0) return null;

  let candidatesTried = 0;
  for (let start = 0; start < text.length; start += 1) {
    const opener = text[start];
    if (opener !== "{" && opener !== "[") continue;

    candidatesTried += 1;
    if (candidatesTried > MAX_JSON_SCAN_CANDIDATES) return null;

    const end = scanBalanced(text, start);
    if (end !== -1) return text.slice(start, end + 1);
  }
  return null;
}

/** Alias kept for ergonomics across the codebase — identical behaviour to {@link extractJsonBlock}. */
export const extractFirstJson = extractJsonBlock;

/**
 * Walk from `start` (an opening `{` or `[`) to its matching close.
 *
 * Tracks a brace/bracket stack, ignores everything inside double-quoted strings, and honours
 * backslash escapes so `"\\"` terminates the string but `"\""` does not.
 *
 * @returns Index of the matching closing character, or `-1` if it never balances.
 */
function scanBalanced(text: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }
    if (ch === "}" || ch === "]") {
      const expected = ch === "}" ? "{" : "[";
      if (stack.length === 0 || stack[stack.length - 1] !== expected) return -1;
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * Appended to the user prompt on the single repair round. Exported so tests can assert the
 * repair actually happened by inspecting `MockTransport.calls[1].user`.
 */
export const REPAIR_INSTRUCTION =
  "Your previous reply did not satisfy the required schema. Validation error: ";

/** Second half of the repair prompt, after the validation error text. */
export const REPAIR_DEMAND =
  "\n\nRespond again with ONLY a single JSON object that conforms exactly to the schema. " +
  "No prose, no explanation, no Markdown code fences.";

/** What the harness persists per cache entry — enough to fully rebuild an `AiOutcome`. */
interface CachedPayload<T> {
  data: T;
  modelId?: string;
  groundingUrls?: string[];
  storedAt: number;
}

/**
 * Optional injectable seams. `now` and `isOnline` are the pinned pair; `sleep` and `jitter` are
 * additive extras that exist purely so retry timing is deterministic under vitest (inject
 * `sleep: () => Promise.resolve()` to make backoff instant without fake timers).
 */
export interface AiHarnessDeps {
  now?: () => number;
  isOnline?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  jitter?: () => number;
}

/** Default clock, guarded so an exotic runtime cannot break latency math. */
function defaultNow(): number {
  try {
    return Date.now();
  } catch {
    return 0;
  }
}

/**
 * Default connectivity probe. Reads `navigator.onLine` when it exists and is a boolean;
 * otherwise assumes online — a non-browser runtime (node/vitest) must not be treated as offline,
 * or every test would silently take the fallback path.
 */
function defaultIsOnline(): boolean {
  try {
    const nav = (globalThis as { navigator?: { onLine?: unknown } }).navigator;
    if (nav && typeof nav.onLine === "boolean") return nav.onLine;
  } catch {
    // Fall through.
  }
  return true;
}

/** Real-time sleep used when no `sleep` seam is injected. */
function defaultSleep(ms: number): Promise<void> {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Flatten a zod (or any) validation failure into a single prompt-safe line. */
function describeValidationError(err: unknown): string {
  try {
    const issues = (err as { issues?: unknown }).issues;
    if (Array.isArray(issues) && issues.length > 0) {
      return issues
        .slice(0, 8)
        .map((issue) => {
          const raw = issue as { path?: unknown; message?: unknown };
          const path = Array.isArray(raw.path) ? raw.path.join(".") : "";
          const message = typeof raw.message === "string" ? raw.message : "invalid value";
          return path.length > 0 ? `${path}: ${message}` : message;
        })
        .join("; ");
    }
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  } catch {
    // Fall through.
  }
  return "response did not match the required schema";
}

/** Summarise a `PromptPayload` for the trace log — full text, but images reduced to count/mime-type so a photo's base64 never bloats the in-memory log. */
function buildRequestLog(payload: PromptPayload): AiRequestLog {
  const images = Array.isArray(payload.images) ? payload.images : [];
  return {
    system: typeof payload.system === "string" ? payload.system : "",
    user: typeof payload.user === "string" ? payload.user : "",
    imageCount: images.length,
    imageMimeTypes: images.map((img) => img.mimeType),
    useSearchGrounding: payload.useSearchGrounding === true,
  };
}

/** Safe message extraction for telemetry/notes. */
function describeError(err: unknown): string {
  try {
    if (typeof err === "string") return err;
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
    return String(err);
  } catch {
    return "unknown error";
  }
}

export class AiHarness {
  private readonly config: HarnessConfig;
  private readonly transport: AiTransport | null;
  private readonly cache: ResponseCache;
  private readonly telemetryStore: HarnessTelemetry;
  private readonly breaker: CircuitBreaker;
  private readonly now: () => number;
  private readonly isOnline: () => boolean;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly jitter: () => number;

  /**
   * @param config Resolved harness settings (see `loadHarnessConfig`).
   * @param transport The selected backend, or `null` when none is usable — a `null` transport is
   *   a normal, fully supported state that routes every call to the deterministic fallback.
   * @param cache Shared response cache. Only validated LIVE results are ever written to it.
   * @param telemetry Shared telemetry log. Exactly one record is appended per `run()`.
   * @param deps Injectable clock / connectivity / sleep / jitter seams for deterministic tests.
   */
  constructor(
    config: HarnessConfig,
    transport: AiTransport | null,
    cache: ResponseCache,
    telemetry: HarnessTelemetry,
    deps?: AiHarnessDeps
  ) {
    this.config = config;
    this.transport = transport ?? null;
    this.cache = cache;
    this.telemetryStore = telemetry;
    this.now = deps && typeof deps.now === "function" ? deps.now : defaultNow;
    this.isOnline = deps && typeof deps.isOnline === "function" ? deps.isOnline : defaultIsOnline;
    this.sleep = deps && typeof deps.sleep === "function" ? deps.sleep : defaultSleep;
    this.jitter = deps && typeof deps.jitter === "function" ? deps.jitter : Math.random;
    this.breaker = new CircuitBreaker(
      config?.circuitBreakerThreshold ?? 3,
      config?.circuitBreakerCooldownMs ?? 60_000,
      this.now
    );
  }

  /** The shared telemetry log, for the AI trace panel. */
  get telemetry(): HarnessTelemetry {
    return this.telemetryStore;
  }

  /**
   * True when the very next `run()` would actually reach the model — i.e. every gate in step 2
   * of the decision table is open. Uses the same predicate `run()` does, so the UI's "live"
   * badge can never disagree with the harness's behaviour.
   */
  isLive(): boolean {
    return this.gateReason() === null;
  }

  /**
   * Execute one AI task. See the decision table at the top of this file.
   *
   * NEVER rejects. NEVER records more than one telemetry row. NEVER caches a fallback.
   */
  async run<TIn, TOut>(task: AiTaskDefinition<TIn, TOut>, input: TIn): Promise<AiOutcome<TOut>> {
    const startedAt = this.now();
    const notes: string[] = [];
    const toolCalls: AiToolCallRecord[] = [];
    let attempts = 0;
    let recorded = false;
    let lastRawText: string | undefined;

    // Built once up front, purely for the trace log — this runs even on the cache/gated paths
    // that never call `transport.generate()`, so a judge or farmer can see what WOULD have been
    // asked even when the answer came from cache or the deterministic fallback. A failure here
    // is captured as "no request to show", never allowed to affect the actual decision table.
    let requestLog: AiRequestLog | undefined;
    if (task && typeof task.buildPrompt === "function") {
      try {
        requestLog = buildRequestLog(task.buildPrompt(input));
      } catch {
        requestLog = undefined;
      }
    }

    /** Records a Google Search grounding call — the only tool wired end-to-end today. */
    const recordSearchToolCall = (payload: PromptPayload, groundingUrls?: string[]): void => {
      if (payload.useSearchGrounding !== true) return;
      toolCalls.push({
        name: "google_search",
        output: { groundingUrls: groundingUrls ?? [] },
        timestamp: new Date(this.now()).toISOString(),
      });
    };

    /** Single exit point: stamps latency, writes the one telemetry row, returns the outcome. */
    const finish = (
      data: TOut,
      source: AiSourceKind,
      extra: {
        modelId?: string;
        groundingUrls?: string[];
        validationRepaired?: boolean;
        errorMessage?: string;
      }
    ): AiOutcome<TOut> => {
      const latencyMs = Math.max(0, this.now() - startedAt);
      const degraded = source === "local" || source === "unavailable";
      const outcome: AiOutcome<TOut> = {
        data,
        source,
        modelId: extra.modelId,
        latencyMs,
        degraded,
        validationRepaired: extra.validationRepaired === true,
        groundingUrls: extra.groundingUrls,
        notes: notes.slice(),
      };
      if (!recorded) {
        recorded = true;
        const record: Omit<AiCallRecord, "sequence"> = {
          taskId: task?.id ?? ("explain-recommendation" as AiCallRecord["taskId"]),
          label: task?.label ?? "unknown task",
          source,
          modelId: extra.modelId,
          latencyMs,
          degraded,
          validationRepaired: outcome.validationRepaired,
          ok: source !== "unavailable",
          errorMessage: extra.errorMessage,
          attempts,
          notes: notes.slice(),
          request: requestLog,
          response: { rawText: lastRawText, parsedData: data, groundingUrls: extra.groundingUrls },
          toolCalls: toolCalls.slice(),
        };
        try {
          this.telemetryStore.record(record);
        } catch {
          // Telemetry must never break a call.
        }
      }
      return outcome;
    };

    /** Steps 4/5: deterministic local answer, or an explicit "unavailable" if even that fails. */
    const useFallback = async (
      reason: string,
      validationRepaired: boolean
    ): Promise<AiOutcome<TOut>> => {
      notes.push(reason);
      try {
        const data = await task.fallback(input);
        return finish(data, "local", { validationRepaired, errorMessage: reason });
      } catch (fallbackErr) {
        const message = describeError(fallbackErr);
        notes.push(`Local fallback failed: ${message}`);
        // No data exists. `data` is typed `TOut` by the contract, so this cast is the documented
        // escape hatch: when `source === "unavailable"`, `data` is undefined at runtime.
        return finish(undefined as unknown as TOut, "unavailable", {
          validationRepaired,
          errorMessage: message,
        });
      }
    };

    // A malformed task object is a programming error, but it must still not reject.
    if (!task || typeof task.buildPrompt !== "function" || typeof task.fallback !== "function") {
      return finish(undefined as unknown as TOut, "unavailable", {
        errorMessage: "Invalid task definition",
      });
    }

    // ---- Step 1: cache -----------------------------------------------------
    const cacheKey = this.buildCacheKey(task, input);
    if (cacheKey !== null) {
      const cached = this.readCache<TOut>(task, cacheKey);
      if (cached !== null) {
        notes.push("Served from cache.");
        return finish(cached.data, "cache", {
          modelId: cached.modelId,
          groundingUrls: cached.groundingUrls,
        });
      }
    }

    // ---- Step 2: gates -----------------------------------------------------
    const gateReason = this.gateReason();
    if (gateReason !== null) {
      return await useFallback(gateReason, false);
    }

    // From here `this.transport` is non-null (gateReason checked it).
    const transport = this.transport as AiTransport;

    // ---- Step 3: live attempts --------------------------------------------
    const maxAttempts = this.resolveMaxAttempts();
    let repairUsed = false;
    let validationRepaired = false;
    let lastError = "AI call failed.";

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
      let payload: PromptPayload;
      try {
        payload = task.buildPrompt(input);
      } catch (buildErr) {
        // Prompt construction is deterministic — retrying cannot help.
        return await useFallback(
          `Prompt construction failed: ${describeError(buildErr)}`,
          validationRepaired
        );
      }

      const opts = this.buildGenerateOptions(task);
      let result: { text: string; modelId: string; groundingUrls?: string[] };

      attempts += 1;
      try {
        result = await transport.generate(payload, opts);
        lastRawText = result.text;
        recordSearchToolCall(payload, result.groundingUrls);
      } catch (rawErr) {
        const err: AiHarnessError = classifyError(rawErr);
        lastError = `${err.kind}: ${err.message}`;
        this.breaker.recordFailure();

        const hasAttemptsLeft = attemptIndex < maxAttempts - 1;
        if (isRetryable(err) && hasAttemptsLeft) {
          const delay = computeBackoffMs(attemptIndex, undefined, this.jitter);
          notes.push(`Attempt ${attempts} failed (${err.kind}); retrying in ${delay}ms.`);
          await this.safeSleep(delay);
          continue;
        }
        return await useFallback(`AI call failed (${lastError}).`, validationRepaired);
      }

      // ---- parse + validate ------------------------------------------------
      const validated = this.parseAndValidate(task, result.text);
      if (validated.ok) {
        this.breaker.recordSuccess();
        this.writeCache(cacheKey, {
          data: validated.data,
          modelId: result.modelId,
          groundingUrls: result.groundingUrls,
          storedAt: this.now(),
        });
        return finish(validated.data, "gemini", {
          modelId: result.modelId,
          groundingUrls: result.groundingUrls,
          validationRepaired,
        });
      }

      lastError = `validation: ${validated.error}`;

      // ---- single repair round --------------------------------------------
      let failureRecorded = false;
      if (!repairUsed) {
        repairUsed = true;
        notes.push(`Response failed validation (${validated.error}); requesting a repair.`);
        const repairPayload: PromptPayload = {
          ...payload,
          user: `${payload.user}\n\n${REPAIR_INSTRUCTION}${validated.error}${REPAIR_DEMAND}`,
        };

        attempts += 1;
        try {
          const repaired = await transport.generate(repairPayload, opts);
          lastRawText = repaired.text;
          recordSearchToolCall(repairPayload, repaired.groundingUrls);
          const revalidated = this.parseAndValidate(task, repaired.text);
          if (revalidated.ok) {
            validationRepaired = true;
            this.breaker.recordSuccess();
            this.writeCache(cacheKey, {
              data: revalidated.data,
              modelId: repaired.modelId,
              groundingUrls: repaired.groundingUrls,
              storedAt: this.now(),
            });
            return finish(revalidated.data, "gemini", {
              modelId: repaired.modelId,
              groundingUrls: repaired.groundingUrls,
              validationRepaired: true,
            });
          }
          lastError = `validation: ${revalidated.error}`;
        } catch (repairErr) {
          const err: AiHarnessError = classifyError(repairErr);
          lastError = `${err.kind}: ${err.message}`;
          this.breaker.recordFailure();
          failureRecorded = true;
        }
      }

      // Repair already spent (or it failed too): a schema mismatch is not retryable, so stop.
      // Persistent unusable output counts against the breaker exactly once.
      if (!failureRecorded) this.breaker.recordFailure();
      return await useFallback(
        `AI response was unusable (${lastError}).`,
        validationRepaired
      );
    }

    // ---- Step 4: attempts exhausted ---------------------------------------
    return await useFallback(`AI call failed after ${attempts} attempt(s): ${lastError}`, validationRepaired);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Why a live call is impossible right now, or `null` when every gate is open. Evaluated in a
   * fixed order so the reported reason is deterministic when several gates are closed.
   */
  private gateReason(): string | null {
    try {
      if (!this.config || this.config.enabled !== true) {
        return "AI is not configured; using the built-in deterministic answer.";
      }
      if (this.transport === null) {
        return "No AI transport available; using the built-in deterministic answer.";
      }
      if (!this.transport.isAvailable()) {
        return `Transport "${this.transport.id}" is unavailable; using the built-in deterministic answer.`;
      }
      if (!this.readIsOnline()) {
        return "Device is offline; using the built-in deterministic answer.";
      }
      if (!this.breaker.canAttempt()) {
        return "AI temporarily disabled after repeated failures; using the built-in deterministic answer.";
      }
      return null;
    } catch (err) {
      return `AI gate check failed (${describeError(err)}); using the built-in deterministic answer.`;
    }
  }

  /** Read the connectivity seam defensively. Anything non-boolean is treated as "online". */
  private readIsOnline(): boolean {
    try {
      return this.isOnline() !== false;
    } catch {
      return true;
    }
  }

  /** Total transport attempts allowed for the primary prompt (the repair round is extra). */
  private resolveMaxAttempts(): number {
    const raw = this.config?.maxRetries;
    if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
    return Math.min(10, Math.max(1, Math.floor(raw)));
  }

  /** Namespaced cache key, or `null` when the task's `cacheKey()` is unusable. */
  private buildCacheKey<TIn, TOut>(task: AiTaskDefinition<TIn, TOut>, input: TIn): string | null {
    try {
      if (typeof task.cacheKey !== "function") return null;
      const key = task.cacheKey(input);
      if (typeof key !== "string" || key.length === 0) return null;
      return `${task.id}:${key}`;
    } catch {
      return null;
    }
  }

  /**
   * Read a cache entry and re-validate it against the CURRENT schema — a value written by an
   * older build must never bypass the trust boundary. A shorter `task.cacheTtlMs` than the
   * cache's own TTL is honoured here.
   */
  private readCache<TOut>(
    task: AiTaskDefinition<unknown, TOut>,
    cacheKey: string
  ): CachedPayload<TOut> | null {
    try {
      const entry = this.cache.get<CachedPayload<TOut>>(cacheKey);
      if (!entry || typeof entry !== "object" || !("data" in entry)) return null;

      const taskTtl = task.cacheTtlMs;
      if (typeof taskTtl === "number" && Number.isFinite(taskTtl)) {
        const storedAt = typeof entry.storedAt === "number" ? entry.storedAt : 0;
        if (this.now() - storedAt >= taskTtl) return null;
      }

      const parsed = task.schema?.safeParse?.(entry.data);
      if (!parsed || parsed.success !== true) return null;
      return {
        data: parsed.data as TOut,
        modelId: entry.modelId,
        groundingUrls: entry.groundingUrls,
        storedAt: entry.storedAt,
      };
    } catch {
      return null;
    }
  }

  /** Persist a validated LIVE result. No-ops for a null key; never called for a fallback. */
  private writeCache<TOut>(cacheKey: string | null, payload: CachedPayload<TOut>): void {
    if (cacheKey === null) return;
    try {
      this.cache.set(cacheKey, payload);
    } catch {
      // ResponseCache already swallows everything; this is belt-and-braces.
    }
  }

  /** Per-call transport options, including the provider JSON schema when the task supplies one. */
  private buildGenerateOptions<TIn, TOut>(task: AiTaskDefinition<TIn, TOut>): GenerateOptions {
    const opts: GenerateOptions = {
      timeoutMs:
        typeof task.timeoutMs === "number" && Number.isFinite(task.timeoutMs) && task.timeoutMs > 0
          ? task.timeoutMs
          : this.config?.timeoutMs ?? 20_000,
    };
    if (task.geminiResponseSchema !== undefined && task.geminiResponseSchema !== null) {
      opts.responseSchema = task.geminiResponseSchema;
    }
    if (typeof task.temperature === "number" && Number.isFinite(task.temperature)) {
      opts.temperature = task.temperature;
    }
    return opts;
  }

  /**
   * The trust boundary: raw model text -> balanced JSON substring -> `JSON.parse` -> zod.
   * Only a value that clears all three escapes the harness.
   */
  private parseAndValidate<TOut>(
    task: AiTaskDefinition<unknown, TOut>,
    text: string
  ): { ok: true; data: TOut } | { ok: false; error: string } {
    let jsonText: string | null;
    try {
      jsonText = extractJsonBlock(text);
    } catch {
      jsonText = null;
    }
    if (jsonText === null) {
      return { ok: false, error: "no JSON object was found in the response" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      return { ok: false, error: `response was not valid JSON (${describeError(err)})` };
    }

    try {
      const result = task.schema.safeParse(parsed);
      if (result.success) return { ok: true, data: result.data as TOut };
      return { ok: false, error: describeValidationError(result.error) };
    } catch (err) {
      return { ok: false, error: describeValidationError(err) };
    }
  }

  /** Sleep that cannot reject, so a hostile injected `sleep` cannot break `run()`. */
  private async safeSleep(ms: number): Promise<void> {
    try {
      await this.sleep(ms);
    } catch {
      // Ignore.
    }
  }
}
