/**
 * Deterministic, threshold-based farming alerts derived from a weather forecast — the "predict
 * the future" half of the weather integration. Every threshold below is a fixed, documented
 * agronomic rule of thumb (never AI-invented, never fetched from a model): a forecast day either
 * crosses a threshold or it doesn't. Per [[krishi-mitra-ai-boundary]], this is exactly the same
 * discipline as `engine/proactiveEngine.ts` — the model may explain what a threshold crossing
 * means, but only this file decides whether one was crossed.
 *
 * Produces the SAME `FarmTimelineEvent` shape `proactiveEngine.ts` does, deliberately — a weather
 * warning and a calendar milestone are both "proactive, engine-computed" facts from the app's
 * point of view, so callers merge the two lists rather than threading a fourth data shape through
 * every prompt/UI surface that already understands `FarmTimelineEvent`.
 */
import type { FarmTimelineEvent, WeatherForecastDay } from "../domain/models/models";

/** kg/acre-style thresholds, but for weather — each is a plain, defensible number a working agronomist would recognise, not a tuned model output. */
const HEAVY_RAIN_PROBABILITY_PERCENT = 70;
const HEAVY_RAIN_QPF_MM = 10;
const HIGH_WIND_KPH = 20;
const HEAT_STRESS_MAX_TEMP_C = 38;
const THUNDERSTORM_PROBABILITY_PERCENT = 50;

function dayAlerts(day: WeatherForecastDay): FarmTimelineEvent[] {
  const alerts: FarmTimelineEvent[] = [];

  if (
    (day.rainProbabilityPercent ?? 0) >= HEAVY_RAIN_PROBABILITY_PERCENT &&
    (day.rainQpfMm ?? 0) >= HEAVY_RAIN_QPF_MM
  ) {
    alerts.push({
      id: `weather-rain-${day.dateIso}`,
      createdAtIso: day.dateIso,
      mode: "proactive",
      kind: "alert",
      source: "engine",
      title: `Heavy rain likely ${day.dateIso}`,
      detail: `${day.rainProbabilityPercent}% chance, ~${day.rainQpfMm}mm expected — postpone spraying, fertiliser application, or harvesting that day.`,
    });
  }

  if ((day.windSpeedKph ?? 0) >= HIGH_WIND_KPH) {
    alerts.push({
      id: `weather-wind-${day.dateIso}`,
      createdAtIso: day.dateIso,
      mode: "proactive",
      kind: "alert",
      source: "engine",
      title: `High winds expected ${day.dateIso}`,
      detail: `~${day.windSpeedKph} km/h forecast — avoid pesticide or fertiliser spraying that day due to spray-drift risk.`,
    });
  }

  if ((day.maxTempC ?? 0) >= HEAT_STRESS_MAX_TEMP_C) {
    alerts.push({
      id: `weather-heat-${day.dateIso}`,
      createdAtIso: day.dateIso,
      mode: "proactive",
      kind: "alert",
      source: "engine",
      title: `High heat expected ${day.dateIso}`,
      detail: `${day.maxTempC}°C forecast — increase irrigation frequency and avoid midday fieldwork.`,
    });
  }

  if ((day.thunderstormProbabilityPercent ?? 0) >= THUNDERSTORM_PROBABILITY_PERCENT) {
    alerts.push({
      id: `weather-storm-${day.dateIso}`,
      createdAtIso: day.dateIso,
      mode: "proactive",
      kind: "alert",
      source: "engine",
      title: `Thunderstorms likely ${day.dateIso}`,
      detail: `${day.thunderstormProbabilityPercent}% chance — avoid fieldwork and postpone spraying that day.`,
    });
  }

  return alerts;
}

/**
 * One alert per (day, crossed threshold), earliest day first. The input forecast is already a
 * near-term window (the API call itself is capped to a handful of days starting today), so
 * unlike `proactiveEngine.ts` this needs no separate "today" or look-ahead window — every day
 * present is already upcoming.
 */
export function buildWeatherAlerts(forecast: WeatherForecastDay[]): FarmTimelineEvent[] {
  return forecast
    .slice()
    .sort((a, b) => a.dateIso.localeCompare(b.dateIso))
    .flatMap(dayAlerts);
}
