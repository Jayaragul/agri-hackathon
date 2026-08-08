/**
 * Environment-driven configuration for the AI harness.
 *
 * Everything here is written to be TOTAL: `loadHarnessConfig` must never throw, because it
 * runs during module initialisation on the critical path of a farmer-facing app. A missing
 * or malformed key is the NORMAL path, not an error — it simply yields `enabled: false`, and
 * the harness falls back to the deterministic local providers.
 *
 * Reads (all optional):
 *   VITE_GEMINI_API_KEY   - Google AI Studio key. Absent => AI disabled, UNLESS VITE_AI_TRANSPORT
 *                           is "server" (see below).
 *   VITE_GEMINI_MODEL     - model id, or a comma-separated preference chain.
 *   VITE_AI_ENABLED       - "false"/"0" hard-disables even when a key is present.
 *   VITE_AI_TRANSPORT     - "sdk" | "rest" | "adk" | "server" | "auto".
 *   VITE_AI_TIMEOUT_MS    - per-call timeout, clamped to a sane range.
 *   VITE_API_BASE_URL     - base URL for "server" transport; empty means same-origin (the
 *                           single-container deploy — see deploy/DEPLOY.md).
 *
 * "server" is the ONLY transport that needs no client-side key at all: it calls this app's own
 * backend (`server/src/routes/aiRoutes.ts`), which reads `GEMINI_API_KEY` from its own
 * environment and never exposes it to the browser. Every other transport reads a `VITE_`-
 * prefixed key, which Vite inlines into the public bundle — acceptable for a quick static demo,
 * not for a real deployment. See catalog.md's "Server-side Gemini proxy" section.
 *
 * SECURITY: `VITE_*` values are inlined into the client bundle by Vite and are therefore
 * PUBLIC. Nothing in this module may ever log `apiKey`.
 */

/** Resolved settings for one harness instance. */
export interface HarnessConfig {
  /** Master switch. False whenever no API key is present, or the operator disabled AI. */
  enabled: boolean;
  /** Google AI Studio key. Empty string when unconfigured. Never log this. */
  apiKey: string;
  /** Model ids in preference order; the transport walks this on model-level failure. */
  modelChain: string[];
  /** Which backend to prefer. "adk" / "auto" selects the Antigravity ADK agent runner. "server" calls this app's own backend, which holds the real key. */
  transportPreference: "adk" | "antigravity-adk" | "sdk" | "rest" | "server" | "auto";
  /** Base URL for the "server" transport and for `services/storage`. Empty means same-origin. */
  apiBase: string;
  /** Per-attempt wall-clock budget in milliseconds. */
  timeoutMs: number;
  /** Maximum attempts per `run()` (retries only apply to transient failures). */
  maxRetries: number;
  /** How long a validated live response stays replayable from cache. */
  cacheTtlMs: number;
  /** Consecutive failures before the circuit breaker opens and stops calling out. */
  circuitBreakerThreshold: number;
  /** How long the breaker stays open before allowing a probe attempt. */
  circuitBreakerCooldownMs: number;
}

/**
 * Verified-current model chain (August 2026). `gemini-3.6-flash` is GA and production ready;
 * `gemini-3.5-flash` is the fallback. Never add `gemini-2.5-flash` — it shuts down 2026-10-16.
 */
export const DEFAULT_MODEL_CHAIN: string[] = ["gemini-3.6-flash", "gemini-3.5-flash"];

const DEFAULT_TIMEOUT_MS = 20_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1_000; // 6 hours
const DEFAULT_BREAKER_THRESHOLD = 3;
const DEFAULT_BREAKER_COOLDOWN_MS = 60_000;

/** Values that disable AI even when a key is present. */
const FALSEY_FLAGS = ["false", "0", "no", "off"];

/** The safe, AI-disabled baseline every code path can fall back to. */
function createDefaultConfig(): HarnessConfig {
  return {
    enabled: false,
    apiKey: "",
    modelChain: DEFAULT_MODEL_CHAIN.slice(),
    transportPreference: "adk",
    apiBase: "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    cacheTtlMs: DEFAULT_CACHE_TTL_MS,
    circuitBreakerThreshold: DEFAULT_BREAKER_THRESHOLD,
    circuitBreakerCooldownMs: DEFAULT_BREAKER_COOLDOWN_MS,
  };
}

/**
 * Pick the env bag to read from. An explicitly supplied object always wins (so tests can
 * inject without touching ambient state); otherwise fall back to `import.meta.env`.
 *
 * Deliberately accesses `import.meta.env` as a direct literal expression rather than through an
 * intermediate `const meta = import.meta; meta.env` alias. Confirmed empirically: Vite's dev-mode
 * client injection only reliably populates `import.meta.env` for a module when that literal
 * pattern appears somewhere in its own source — the aliased/indirect form left `import.meta`
 * looking like a bare `{url: string}` object at runtime (no thrown error, just silently absent),
 * which made this resolve to the all-defaults "adk"/disabled config even with a real
 * `VITE_AI_TRANSPORT=server` in `.env`. `src/vite-env.d.ts` (`/// <reference types="vite/client" />`)
 * is what makes this typecheck without a cast.
 */
function resolveEnvSource(env?: Record<string, unknown>): Record<string, unknown> {
  if (env && typeof env === "object") {
    return env as Record<string, unknown>;
  }
  try {
    const metaEnv = import.meta.env;
    if (metaEnv && typeof metaEnv === "object") {
      return metaEnv as unknown as Record<string, unknown>;
    }
  } catch {
    // import.meta.env unavailable in this runtime — fall through to an empty bag.
  }
  return {};
}

/** Read a key as a trimmed string. Anything unusable becomes "". */
function readString(source: Record<string, unknown>, key: string): string {
  try {
    const value = source[key];
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return String(value);
    return "";
  } catch {
    return "";
  }
}

/** Read a key as a positive integer, clamped to [min, max]; invalid input yields `fallback`. */
function readClampedInt(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = readString(source, key);
  if (raw.length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * Build the model chain: operator-specified ids first (a comma-separated list is allowed),
 * then the verified defaults appended as a safety net, de-duplicated and never empty.
 */
function resolveModelChain(raw: string): string[] {
  const chain: string[] = [];
  const push = (id: string): void => {
    const trimmed = id.trim();
    if (trimmed.length > 0 && chain.indexOf(trimmed) === -1) chain.push(trimmed);
  };
  if (raw.length > 0) {
    for (const part of raw.split(",")) push(part);
  }
  for (const fallback of DEFAULT_MODEL_CHAIN) push(fallback);
  return chain.length > 0 ? chain : DEFAULT_MODEL_CHAIN.slice();
}

/** Normalise the transport preference; anything unrecognised means "adk". */
function resolveTransportPreference(raw: string): HarnessConfig["transportPreference"] {
  const value = raw.toLowerCase().trim();
  if (
    value === "adk" ||
    value === "antigravity-adk" ||
    value === "sdk" ||
    value === "rest" ||
    value === "server" ||
    value === "auto"
  ) {
    return value;
  }
  return "adk";
}

/**
 * Build a `HarnessConfig` from an env bag (defaults to `import.meta.env`).
 *
 * Total by contract: tolerates `undefined`, a non-object, missing keys, and non-string
 * values, and never throws. AI is enabled when `VITE_AI_ENABLED` is not one of
 * "false"/"0"/"no"/"off", AND either a client-side API key is present OR the transport
 * preference is "server" (which needs no client key — see the module doc above).
 */
export function loadHarnessConfig(env?: Record<string, unknown>): HarnessConfig {
  const config = createDefaultConfig();
  try {
    const source = resolveEnvSource(env);

    config.apiKey = readString(source, "VITE_GEMINI_API_KEY");
    config.modelChain = resolveModelChain(readString(source, "VITE_GEMINI_MODEL"));
    config.transportPreference = resolveTransportPreference(
      readString(source, "VITE_AI_TRANSPORT")
    );
    config.apiBase = readString(source, "VITE_API_BASE_URL").replace(/\/$/, "");
    config.timeoutMs = readClampedInt(
      source,
      "VITE_AI_TIMEOUT_MS",
      DEFAULT_TIMEOUT_MS,
      MIN_TIMEOUT_MS,
      MAX_TIMEOUT_MS
    );

    const enabledFlag = readString(source, "VITE_AI_ENABLED").toLowerCase();
    const explicitlyDisabled = FALSEY_FLAGS.indexOf(enabledFlag) !== -1;
    const hasUsableBackend = config.apiKey.length > 0 || config.transportPreference === "server";
    config.enabled = hasUsableBackend && !explicitlyDisabled;

    return config;
  } catch {
    // Any unexpected failure degrades to the AI-disabled baseline rather than breaking boot.
    return createDefaultConfig();
  }
}

/**
 * True when the harness could actually reach a model: enabled, with either a client-side key
 * or the key-free "server" transport, and at least one model to try. Callers use this to
 * decide whether to show live-AI affordances at all, rather than inspecting `apiKey` directly.
 */
export function isAiConfigured(config: HarnessConfig): boolean {
  if (!config || typeof config !== "object") return false;
  const hasUsableBackend =
    (typeof config.apiKey === "string" && config.apiKey.trim().length > 0) ||
    config.transportPreference === "server";
  return (
    config.enabled === true &&
    hasUsableBackend &&
    Array.isArray(config.modelChain) &&
    config.modelChain.length > 0
  );
}
