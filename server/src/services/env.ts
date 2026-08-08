/**
 * Shared environment readers — one place so `aiRoutes.ts`, `liveRoutes.ts`, and `voiceRoutes.ts`
 * agree on key names. Every one of these is read fresh on every call (never cached at startup),
 * because `pickApiKey` below picks a different key each time a variable holds more than one.
 */

/**
 * A key variable may hold a single key or a comma-separated list — a farmer-facing demo
 * pulling from a shared quota benefits from spreading calls across several keys rather than
 * hammering one and hitting a rate limit. Picking randomly per call (not round-robin) needs no
 * state to track across requests, which matters for a stateless server that could restart or
 * scale to multiple instances at any time.
 */
export function pickApiKey(raw: string | undefined): string {
  const keys = (raw ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  if (keys.length === 0) return "";
  if (keys.length === 1) return keys[0];
  return keys[Math.floor(Math.random() * keys.length)];
}

export function resolveGeminiApiKey(): string {
  return pickApiKey(process.env.GEMINI_API_KEY) || pickApiKey(process.env.GOOGLE_API_KEY);
}

export function resolveMem0ApiKey(): string {
  return process.env.MEM0_API_KEY?.trim() || "";
}

export function resolveSarvamApiKey(): string {
  return pickApiKey(process.env.SARVAM_API_KEY);
}

/** BCP-47-ish language code Sarvam expects (e.g. "ta-IN", "hi-IN", "en-IN"). Tamil Nadu farmers by default. */
export function resolveSarvamLanguage(): string {
  return process.env.SARVAM_LANGUAGE?.trim() || "ta-IN";
}

export function resolveWeatherApiKey(): string {
  return pickApiKey(process.env.GOOGLE_WEATHER_API_KEY);
}
