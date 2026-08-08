/**
 * Server-side Google Weather API proxy — same trust boundary as `geminiProxy.ts`/`sarvamProxy.ts`:
 * `GOOGLE_WEATHER_API_KEY` is read from the server's own environment and never reaches the
 * browser. The frontend's `services/weather/weatherClient.ts` only ever calls this server's own
 * `/api/weather/*` routes.
 *
 * Docs (verified live, June 2025 GA): https://developers.google.com/maps/documentation/weather
 * — `forecast/days:lookup` returns up to 10 daily forecasts, metric units by default, India is
 * within the supported region set (excluded: Japan, Korea, prohibited territories).
 *
 * `location` is resolved server-side from a closed set of region names (see `REGION_COORDINATES`
 * below), NOT accepted as raw lat/lng from the client — the same closed-set discipline this app
 * already applies to crops/pests, and it means a request can never spend this app's paid API
 * quota on an arbitrary global coordinate.
 */

const WEATHER_API_BASE = "https://weather.googleapis.com/v1";
const MAX_ERROR_BODY_CHARS = 300;
const DEFAULT_DAYS = 5;
const MAX_DAYS = 10;

export class WeatherProxyError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "WeatherProxyError";
  }
}

/**
 * Town-center coordinates for the fixed region list `FarmProfileForm.tsx` offers
 * (`src/features/farm-profile/FarmProfileForm.tsx`'s region `<select>`). Deterministic and
 * curated, same convention as `src/data/sample/*.ts` — no geocoding API needed for four known
 * towns.
 */
export const REGION_COORDINATES: Record<string, { latitude: number; longitude: number }> = {
  Coimbatore: { latitude: 11.0168, longitude: 76.9558 },
  Pollachi: { latitude: 10.6591, longitude: 77.0086 },
  Tiruppur: { latitude: 11.1085, longitude: 77.3411 },
  Mettupalayam: { latitude: 11.2996, longitude: 76.937 },
};

export function isKnownRegion(region: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGION_COORDINATES, region);
}

/** Clean, minimal shape the rest of this app actually uses — never the raw Google payload. */
export interface WeatherForecastDay {
  dateIso: string;
  minTempC: number | null;
  maxTempC: number | null;
  rainProbabilityPercent: number | null;
  rainQpfMm: number | null;
  windSpeedKph: number | null;
  humidityPercent: number | null;
  thunderstormProbabilityPercent: number | null;
  /** Google's own closed vocabulary, e.g. "RAIN_SHOWERS", "CLEAR", "PARTLY_CLOUDY" — relayed as-is, never invented. */
  conditionType: string | null;
}

function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

interface RawTemperature {
  degrees?: number;
}
interface RawPrecipitation {
  probability?: { percent?: number };
  qpf?: { quantity?: number };
}
interface RawWind {
  speed?: { value?: number };
}
interface RawDayPart {
  precipitation?: RawPrecipitation;
  wind?: RawWind;
  relativeHumidity?: number;
  thunderstormProbability?: number;
  weatherCondition?: { type?: string };
}
interface RawForecastDay {
  displayDate?: { year?: number; month?: number; day?: number };
  maxTemperature?: RawTemperature;
  minTemperature?: RawTemperature;
  daytimeForecast?: RawDayPart;
}
interface RawForecastResponse {
  forecastDays?: RawForecastDay[];
  error?: { code?: number; message?: string };
}

function toIsoDate(date?: { year?: number; month?: number; day?: number }): string | null {
  if (!date?.year || !date.month || !date.day) return null;
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapForecastDay(raw: RawForecastDay): WeatherForecastDay | null {
  const dateIso = toIsoDate(raw.displayDate);
  if (!dateIso) return null;
  const day = raw.daytimeForecast ?? {};
  return {
    dateIso,
    minTempC: numberOrNull(raw.minTemperature?.degrees),
    maxTempC: numberOrNull(raw.maxTemperature?.degrees),
    rainProbabilityPercent: numberOrNull(day.precipitation?.probability?.percent),
    rainQpfMm: numberOrNull(day.precipitation?.qpf?.quantity),
    windSpeedKph: numberOrNull(day.wind?.speed?.value),
    humidityPercent: numberOrNull(day.relativeHumidity),
    thunderstormProbabilityPercent: numberOrNull(day.thunderstormProbability),
    conditionType: typeof day.weatherCondition?.type === "string" ? day.weatherCondition.type : null,
  };
}

/**
 * Up to `days` days of daily forecast for one of the app's known regions. `unitsSystem=METRIC`
 * is passed explicitly (rather than relying on its documented default) so a future API change
 * to that default can never silently start returning Fahrenheit/mph into this app's Celsius/kph
 * assumptions.
 */
export async function getDailyForecast(
  apiKey: string,
  region: string,
  days: number = DEFAULT_DAYS,
  fetchImpl: typeof fetch = fetch
): Promise<WeatherForecastDay[]> {
  if (!apiKey) throw new WeatherProxyError(503, "Weather is not configured on the server (GOOGLE_WEATHER_API_KEY is unset).");
  const coords = REGION_COORDINATES[region];
  if (!coords) throw new WeatherProxyError(400, `Unknown region "${region}".`);

  const clampedDays = Math.min(MAX_DAYS, Math.max(1, Math.floor(days)));
  const params = new URLSearchParams({
    key: apiKey,
    "location.latitude": String(coords.latitude),
    "location.longitude": String(coords.longitude),
    unitsSystem: "METRIC",
    days: String(clampedDays),
  });

  const response = await fetchImpl(`${WEATHER_API_BASE}/forecast/days:lookup?${params.toString()}`);

  if (!response.ok) {
    const detail = truncate(await response.text().catch(() => ""), MAX_ERROR_BODY_CHARS);
    throw new WeatherProxyError(response.status, `Weather API failed with HTTP ${response.status}${detail ? `: ${detail}` : "."}`);
  }

  const payload = (await response.json()) as RawForecastResponse;
  if (payload.error) {
    throw new WeatherProxyError(
      typeof payload.error.code === "number" ? payload.error.code : 502,
      truncate(payload.error.message ?? "Weather API returned an error.", MAX_ERROR_BODY_CHARS)
    );
  }

  const days_ = Array.isArray(payload.forecastDays) ? payload.forecastDays : [];
  return days_.map(mapForecastDay).filter((d): d is WeatherForecastDay => d !== null);
}
