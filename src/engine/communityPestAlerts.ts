/**
 * Deterministic proximity + crop-match alerting for the "Community Pest Watch" simulation — the
 * engine layer, per [[krishi-mitra-ai-boundary]]: this only compares real numbers (distance,
 * crop id match) that other data already carries; no AI call, nothing invented. See
 * `services/community/communityClient.ts` for where the simulated farmers come from and
 * `data/sample/digitalTwinFields.ts` for the real branches this checks proximity against.
 *
 * Alerts are anonymized by construction — a `CommunityAlert` never carries a simulated farmer's
 * id, only a distance and a crop/pest name, exactly matching the "someone near you has this,
 * we never reveal who" framing this feature was built for.
 */
import type { MonitoringArea } from "../domain/digitalTwin/models";
import type { SimulatedCommunityFarmer } from "../domain/digitalTwin/communityModels";
import { getDigitalTwinCrop } from "../data/sample/digitalTwinCrops";

export interface CommunityAlert {
  areaId: string;
  areaName: string;
  cropId: string;
  cropName: string;
  pestName: string;
  severity: "low" | "medium" | "high";
  /** Distance in km from the branch's coordinates to the NEAREST matching simulated farmer. */
  nearestDistanceKm: number;
  /** How many distinct simulated farmers within range are reporting this same pest on this same crop. */
  matchingFarmerCount: number;
}

const EARTH_RADIUS_KM = 6371;

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// 15km — a realistic regional pest-advisory catchment (comparable to what agricultural extension
// pest-window bulletins use), and wide enough to reliably surface at least one alert against the
// current 2-branch demo dataset rather than depending on luck with only 2 fixed points to match
// against 30 scattered simulated farmers. Verified against the deployed seed: this includes each
// branch's nearest same-crop reporting farmer (~11-13km away) with a few km of margin, while still
// excluding the majority of the 22km-radius scatter as genuinely "too far to be relevant."
const DEFAULT_RADIUS_KM = 15;

/**
 * For every real branch's distinct crops, finds simulated farmers within `radiusKm` growing the
 * same crop with an active pest report, and produces one deduplicated alert per
 * (branch, crop, pest) combination — so five nearby farmers all fighting the same pest on the
 * same crop surface as ONE alert with a count, not five near-duplicate cards.
 */
export function buildCommunityAlerts(
  areas: MonitoringArea[],
  farmers: SimulatedCommunityFarmer[],
  radiusKm: number = DEFAULT_RADIUS_KM
): CommunityAlert[] {
  const reportingFarmers = farmers.filter((f) => f.activePestReport !== null);
  if (reportingFarmers.length === 0) return [];

  const alertsByKey = new Map<string, CommunityAlert>();

  for (const area of areas) {
    const cropIdsInArea = new Set(area.fields.map((f) => f.cropId));
    for (const cropId of cropIdsInArea) {
      const crop = getDigitalTwinCrop(cropId);
      if (!crop) continue;

      const matches = reportingFarmers
        .filter((f) => f.cropId === cropId)
        .map((f) => ({ farmer: f, distanceKm: haversineKm({ lat: area.coords[0], lng: area.coords[1] }, { lat: f.lat, lng: f.lng }) }))
        .filter((m) => m.distanceKm <= radiusKm);

      if (matches.length === 0) continue;

      // One alert per distinct pest name reported nearby for this crop (a crop could have more
      // than one pest circulating in the simulation at once).
      const byPest = new Map<string, typeof matches>();
      for (const m of matches) {
        const pestName = m.farmer.activePestReport!.pestName;
        const list = byPest.get(pestName) ?? [];
        list.push(m);
        byPest.set(pestName, list);
      }

      for (const [pestName, group] of byPest) {
        const nearest = group.reduce((min, m) => (m.distanceKm < min.distanceKm ? m : min));
        const key = `${area.id}::${cropId}::${pestName}`;
        alertsByKey.set(key, {
          areaId: area.id,
          areaName: area.name,
          cropId,
          cropName: crop.name,
          pestName,
          severity: nearest.farmer.activePestReport!.severity,
          nearestDistanceKm: Math.round(nearest.distanceKm * 10) / 10,
          matchingFarmerCount: group.length,
        });
      }
    }
  }

  return Array.from(alertsByKey.values()).sort((a, b) => a.nearestDistanceKm - b.nearestDistanceKm);
}

export function describeCommunityAlert(alert: CommunityAlert): string {
  const farmerWord = alert.matchingFarmerCount === 1 ? "A farmer" : `${alert.matchingFarmerCount} farmers`;
  return `${farmerWord} within ${alert.nearestDistanceKm} km ${alert.matchingFarmerCount === 1 ? "is" : "are"} dealing with ${alert.pestName} on ${alert.cropName} — your ${alert.areaName} grows ${alert.cropName} too. Watch your field closely this week.`;
}
