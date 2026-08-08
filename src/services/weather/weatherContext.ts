/**
 * One place that turns "which region is this farm in" into "what should the farmer be warned
 * about this week," so every call site (Audio Mode, the typed Advisor, Crop Doctor Live, the
 * Cultivation Calendar) fetches and interprets weather the same way instead of each re-deriving
 * it. Mirrors how `services/memory/memoryClient.ts` wraps mem0 — a single async helper alongside
 * the synchronous `farmContext.ts` snapshot, since a live network fetch can't live inside that
 * snapshot's synchronous contract.
 */
import { getWeatherForecast } from "./weatherClient";
import { buildWeatherAlerts } from "../../engine/weatherRules";
import type { FarmTimelineEvent } from "../../domain/models/models";

/** `[]` for no region, no configured key, or any network failure — weather grounding is a bonus, never a blocker. */
export async function getWeatherProactiveAlerts(region: string | null | undefined): Promise<FarmTimelineEvent[]> {
  if (!region) return [];
  try {
    const forecast = await getWeatherForecast(region);
    return buildWeatherAlerts(forecast);
  } catch {
    return [];
  }
}
