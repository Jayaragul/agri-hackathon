import { describe, expect, it } from "vitest";
import { buildWeatherAlerts } from "../engine/weatherRules";
import type { WeatherForecastDay } from "../domain/models/models";

function clearDay(dateIso: string): WeatherForecastDay {
  return {
    dateIso,
    minTempC: 22,
    maxTempC: 30,
    rainProbabilityPercent: 10,
    rainQpfMm: 0,
    windSpeedKph: 8,
    humidityPercent: 60,
    thunderstormProbabilityPercent: 5,
    conditionType: "CLEAR",
  };
}

describe("buildWeatherAlerts", () => {
  it("produces nothing for an unremarkable forecast", () => {
    expect(buildWeatherAlerts([clearDay("2026-07-01")])).toEqual([]);
  });

  it("flags heavy rain only when BOTH probability and quantity cross their thresholds", () => {
    const highProbabilityOnly = { ...clearDay("2026-07-01"), rainProbabilityPercent: 90, rainQpfMm: 2 };
    const highQuantityOnly = { ...clearDay("2026-07-01"), rainProbabilityPercent: 20, rainQpfMm: 25 };
    const both = { ...clearDay("2026-07-01"), rainProbabilityPercent: 85, rainQpfMm: 20 };

    expect(buildWeatherAlerts([highProbabilityOnly])).toEqual([]);
    expect(buildWeatherAlerts([highQuantityOnly])).toEqual([]);

    const alerts = buildWeatherAlerts([both]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ mode: "proactive", kind: "alert", source: "engine" });
    expect(alerts[0].title).toContain("Heavy rain");
    expect(alerts[0].detail).toContain("85%");
    expect(alerts[0].detail).toContain("20mm");
  });

  it("flags high wind above the spray-drift threshold", () => {
    const windy = { ...clearDay("2026-07-02"), windSpeedKph: 25 };
    const alerts = buildWeatherAlerts([windy]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain("High winds");
    expect(alerts[0].detail.toLowerCase()).toContain("spray");
  });

  it("flags heat stress at or above the threshold", () => {
    const hot = { ...clearDay("2026-07-03"), maxTempC: 40 };
    const alerts = buildWeatherAlerts([hot]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain("High heat");
    expect(alerts[0].detail.toLowerCase()).toContain("irrigation");
  });

  it("flags a high thunderstorm probability", () => {
    const stormy = { ...clearDay("2026-07-04"), thunderstormProbabilityPercent: 65 };
    const alerts = buildWeatherAlerts([stormy]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain("Thunderstorms");
  });

  it("never divides by a missing field — null values are treated as 'no signal', not zero-crossing a threshold", () => {
    const allNull: WeatherForecastDay = {
      dateIso: "2026-07-05",
      minTempC: null,
      maxTempC: null,
      rainProbabilityPercent: null,
      rainQpfMm: null,
      windSpeedKph: null,
      humidityPercent: null,
      thunderstormProbabilityPercent: null,
      conditionType: null,
    };
    expect(buildWeatherAlerts([allNull])).toEqual([]);
  });

  it("can raise multiple distinct alerts for the same day when multiple thresholds cross", () => {
    const badDay = { ...clearDay("2026-07-06"), windSpeedKph: 30, maxTempC: 41 };
    const alerts = buildWeatherAlerts([badDay]);
    expect(alerts).toHaveLength(2);
    expect(alerts.map((a) => a.title).sort()).toEqual(["High heat expected 2026-07-06", "High winds expected 2026-07-06"]);
  });

  it("sorts alerts by date, earliest first, regardless of input order", () => {
    const later = { ...clearDay("2026-07-10"), windSpeedKph: 25 };
    const earlier = { ...clearDay("2026-07-08"), windSpeedKph: 25 };
    const alerts = buildWeatherAlerts([later, earlier]);
    expect(alerts.map((a) => a.id)).toEqual(["weather-wind-2026-07-08", "weather-wind-2026-07-10"]);
  });
});
