/**
 * Chooses the backend the harness will call, based on `HarnessConfig.transportPreference`.
 *
 * Returning `null` is a first-class, expected outcome — not an error. No key, AI switched off,
 * or an empty model chain all mean "run the deterministic local fallbacks", which is the
 * app's normal offline mode. `AiHarness` treats a null transport as an immediate fallback.
 *
 * Like everything on the boot path, this must never throw.
 */

import type { AiTransport } from "../contracts/aiTypes";
import { isAiConfigured } from "../runtime/harnessConfig";
import type { HarnessConfig } from "../runtime/harnessConfig";
import { AntigravityAdkTransport } from "./AntigravityAdkTransport";
import { GeminiRestTransport } from "./GeminiRestTransport";
import { GeminiSdkTransport } from "./GeminiSdkTransport";
import { ServerProxyTransport } from "./ServerProxyTransport";

/**
 * Build the preferred transport for `config`, or `null` when AI cannot run.
 *
 * - `"server"`                    -> `ServerProxyTransport` ONLY, no client-key fallback chain —
 *   the whole point of this mode is that no client-side key exists to fall back to.
 * - `"adk"` / `"antigravity-adk"` -> `AntigravityAdkTransport`
 * - `"sdk"`                       -> `GeminiSdkTransport`
 * - `"rest"`                      -> `GeminiRestTransport`
 * - `"auto"`                      -> `AntigravityAdkTransport` -> `GeminiSdkTransport` -> `GeminiRestTransport`
 */
export function selectTransport(config: HarnessConfig): AiTransport | null {
  try {
    if (!isAiConfigured(config)) return null;

    const preference = config.transportPreference;

    if (preference === "server") {
      return firstAvailable([() => new ServerProxyTransport(config, config.apiBase)]);
    }

    if (preference === "adk" || preference === "antigravity-adk") {
      return firstAvailable([
        () => new AntigravityAdkTransport(config),
        () => new GeminiSdkTransport(config),
        () => new GeminiRestTransport(config),
      ]);
    }

    if (preference === "rest") {
      return firstAvailable([
        () => new GeminiRestTransport(config),
        () => new AntigravityAdkTransport(config),
        () => new GeminiSdkTransport(config),
      ]);
    }

    if (preference === "sdk") {
      return firstAvailable([
        () => new GeminiSdkTransport(config),
        () => new AntigravityAdkTransport(config),
        () => new GeminiRestTransport(config),
      ]);
    }

    // "auto" prioritizes the Antigravity ADK transport
    return firstAvailable([
      () => new AntigravityAdkTransport(config),
      () => new GeminiSdkTransport(config),
      () => new GeminiRestTransport(config),
    ]);
  } catch {
    // A broken transport must degrade the app to offline mode, never crash boot.
    return null;
  }
}

/** Construct candidates in order, returning the first that reports itself usable. */
function firstAvailable(factories: Array<() => AiTransport>): AiTransport | null {
  for (const factory of factories) {
    try {
      const transport = factory();
      if (transport.isAvailable()) return transport;
    } catch {
      // Constructor blew up (e.g. SDK missing) — try the next candidate.
    }
  }
  return null;
}
