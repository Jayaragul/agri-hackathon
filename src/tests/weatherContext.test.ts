import { describe, expect, it, vi, beforeEach } from "vitest";
import { getWeatherProactiveAlerts } from "../services/weather/weatherContext";

const mocks = vi.hoisted(() => ({ getWeatherForecast: vi.fn() }));

vi.mock("../services/weather/weatherClient", () => ({
  getWeatherForecast: mocks.getWeatherForecast,
}));

describe("getWeatherProactiveAlerts", () => {
  beforeEach(() => {
    mocks.getWeatherForecast.mockReset();
  });

  it("returns [] and never calls the client when there is no region", async () => {
    expect(await getWeatherProactiveAlerts(null)).toEqual([]);
    expect(await getWeatherProactiveAlerts(undefined)).toEqual([]);
    expect(mocks.getWeatherForecast).not.toHaveBeenCalled();
  });

  it("builds alerts from whatever the client returns", async () => {
    mocks.getWeatherForecast.mockResolvedValue([
      {
        dateIso: "2026-07-01",
        minTempC: 24,
        maxTempC: 41,
        rainProbabilityPercent: 10,
        rainQpfMm: 0,
        windSpeedKph: 5,
        humidityPercent: 50,
        thunderstormProbabilityPercent: 5,
        conditionType: "CLEAR",
      },
    ]);
    const alerts = await getWeatherProactiveAlerts("Coimbatore");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain("High heat");
    expect(mocks.getWeatherForecast).toHaveBeenCalledWith("Coimbatore");
  });

  it("degrades to [] if the client rejects rather than resolving []", async () => {
    mocks.getWeatherForecast.mockRejectedValue(new Error("network down"));
    await expect(getWeatherProactiveAlerts("Coimbatore")).resolves.toEqual([]);
  });
});
