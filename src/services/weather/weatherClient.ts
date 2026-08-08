/**
 * Frontend client for the weather forecast, proxied through this app's own backend
 * (`server/src/routes/weatherRoutes.ts`) so `GOOGLE_WEATHER_API_KEY` never reaches the browser —
 * same security posture as `services/voice/sarvamClient.ts`.
 *
 * Silently-degrading by design (unlike `sarvamClient.ts`): a farmer never taps a button to
 * request weather directly, so there's no moment where "weather failed" needs its own error UI.
 * A missing key, a network failure, or an unknown region all just mean `[]` — the deterministic
 * `engine/weatherRules.ts` already treats an empty forecast as "nothing to warn about."
 */
import type { WeatherForecastDay } from "../../domain/models/models";

// Direct `import.meta.env.KEY` access, not an aliased `const meta = import.meta; meta.env`
// indirection — see the comment on `resolveEnvSource` in `services/ai/runtime/harnessConfig.ts`
// for why the indirect form silently resolves to nothing under Vite's dev-mode client injection.
function readApiBase(): string {
  try {
    const raw = import.meta.env.VITE_API_BASE_URL;
    return typeof raw === "string" ? raw.trim().replace(/\/$/, "") : "";
  } catch {
    return "";
  }
}

/** Whether the backend has a weather key configured — checked once so callers can skip the round-trip entirely when it's not. */
export async function getWeatherStatus(): Promise<{ configured: boolean }> {
  try {
    const response = await fetch(`${readApiBase()}/api/weather/status`);
    if (!response.ok) return { configured: false };
    const body = (await response.json()) as { configured?: boolean };
    return { configured: Boolean(body.configured) };
  } catch {
    return { configured: false };
  }
}

/** Up to `days` days of forecast for a known region (see `server/src/services/weatherProxy.ts`'s `REGION_COORDINATES`). Never throws — an unknown region, a missing key, or a network failure all resolve to `[]`. */
export async function getWeatherForecast(region: string, days = 5): Promise<WeatherForecastDay[]> {
  try {
    const params = new URLSearchParams({ region, days: String(days) });
    const response = await fetch(`${readApiBase()}/api/weather/forecast?${params.toString()}`);
    if (!response.ok) return [];
    const body = (await response.json()) as { days?: WeatherForecastDay[] };
    return Array.isArray(body.days) ? body.days : [];
  } catch {
    return [];
  }
}
