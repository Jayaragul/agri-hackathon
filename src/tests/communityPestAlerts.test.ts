import { describe, it, expect } from "vitest";
import { buildCommunityAlerts, describeCommunityAlert } from "../engine/communityPestAlerts";
import type { MonitoringArea } from "../domain/digitalTwin/models";
import type { SimulatedCommunityFarmer } from "../domain/digitalTwin/communityModels";

// Singanallur's real coordinates from data/sample/digitalTwinFields.ts, reused here so distance
// math against nearby fake farmers is realistic without importing the sample dataset.
const AREA: MonitoringArea = {
  id: "singanallur",
  name: "Singanallur Branch",
  taluk: "Coimbatore South",
  coords: [11.0042, 77.0243],
  fields: [
    { id: "sgn-1", name: "Block A", cropId: "maize", areaHa: 2, sownDaysAgo: 20, irrigationCycleDays: 5, bias: {} },
    { id: "sgn-2", name: "Block B", cropId: "onion", areaHa: 1, sownDaysAgo: 10, irrigationCycleDays: 3, bias: {} },
  ],
};

function farmer(overrides: Partial<SimulatedCommunityFarmer>): SimulatedCommunityFarmer {
  return {
    id: "sim-farmer-1",
    lat: AREA.coords[0] + 0.01, // ~1.1km north
    lng: AREA.coords[1],
    cropId: "maize",
    activePestReport: { pestName: "Fall armyworm", severity: "medium", reportedAtIso: new Date().toISOString() },
    ...overrides,
  };
}

describe("buildCommunityAlerts", () => {
  it("returns no alerts when no farmers are reporting anything", () => {
    const farmers = [farmer({ activePestReport: null })];
    expect(buildCommunityAlerts([AREA], farmers)).toEqual([]);
  });

  it("alerts when a nearby farmer shares the same crop and has an active report", () => {
    const alerts = buildCommunityAlerts([AREA], [farmer({})]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      areaId: "singanallur",
      cropId: "maize",
      pestName: "Fall armyworm",
      matchingFarmerCount: 1,
    });
    expect(alerts[0].nearestDistanceKm).toBeGreaterThan(0);
  });

  it("does not alert when the crop doesn't match any field at that branch", () => {
    const farmers = [farmer({ cropId: "cotton" })];
    expect(buildCommunityAlerts([AREA], farmers)).toEqual([]);
  });

  it("does not alert when the reporting farmer is outside the radius", () => {
    const farFarmer = farmer({ lat: AREA.coords[0] + 2, lng: AREA.coords[1] + 2 }); // hundreds of km away
    expect(buildCommunityAlerts([AREA], [farFarmer], 8)).toEqual([]);
  });

  it("dedupes multiple matching farmers into one alert with a count, keeping the nearest distance", () => {
    const near = farmer({ id: "a", lat: AREA.coords[0] + 0.01 });
    const far = farmer({ id: "b", lat: AREA.coords[0] + 0.05 });
    const alerts = buildCommunityAlerts([AREA], [near, far]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].matchingFarmerCount).toBe(2);
    expect(alerts[0].nearestDistanceKm).toBeLessThan(haversineDistanceOf(far, AREA));
  });

  it("produces a separate alert per distinct pest on the same crop", () => {
    const armyworm = farmer({ id: "a", activePestReport: { pestName: "Fall armyworm", severity: "medium", reportedAtIso: new Date().toISOString() } });
    const stemBorer = farmer({ id: "b", activePestReport: { pestName: "Stem borer", severity: "low", reportedAtIso: new Date().toISOString() } });
    const alerts = buildCommunityAlerts([AREA], [armyworm, stemBorer]);
    expect(alerts.map((a) => a.pestName).sort()).toEqual(["Fall armyworm", "Stem borer"]);
  });

  it("never reveals a simulated farmer's id — describeCommunityAlert output is anonymized", () => {
    const alerts = buildCommunityAlerts([AREA], [farmer({ id: "sim-farmer-secret-42" })]);
    const text = describeCommunityAlert(alerts[0]);
    expect(text).not.toContain("sim-farmer-secret-42");
    expect(text).toContain("Fall armyworm");
    expect(text).toContain("Singanallur Branch");
  });
});

function haversineDistanceOf(f: SimulatedCommunityFarmer, area: MonitoringArea): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(f.lat - area.coords[0]);
  const dLng = toRad(f.lng - area.coords[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(area.coords[0])) * Math.cos(toRad(f.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
