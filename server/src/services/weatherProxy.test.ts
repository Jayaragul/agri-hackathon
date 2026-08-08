import { describe, expect, it, vi } from "vitest";
import { getDailyForecast, isKnownRegion, WeatherProxyError } from "./weatherProxy";

const SAMPLE_RESPONSE = {
  forecastDays: [
    {
      displayDate: { year: 2026, month: 7, day: 7 },
      maxTemperature: { degrees: 34.5 },
      minTemperature: { degrees: 24.1 },
      daytimeForecast: {
        precipitation: { probability: { percent: 80 }, qpf: { quantity: 15 } },
        wind: { speed: { value: 18 } },
        relativeHumidity: 72,
        thunderstormProbability: 20,
        weatherCondition: { type: "RAIN_SHOWERS" },
      },
    },
  ],
};

describe("isKnownRegion", () => {
  it("accepts the four regions the wizard offers", () => {
    expect(isKnownRegion("Coimbatore")).toBe(true);
    expect(isKnownRegion("Pollachi")).toBe(true);
    expect(isKnownRegion("Tiruppur")).toBe(true);
    expect(isKnownRegion("Mettupalayam")).toBe(true);
  });

  it("rejects anything outside that closed set", () => {
    expect(isKnownRegion("Chennai")).toBe(false);
    expect(isKnownRegion("")).toBe(false);
  });
});

describe("getDailyForecast", () => {
  it("refuses to call the API without a server-side key", async () => {
    await expect(getDailyForecast("", "Coimbatore")).rejects.toMatchObject({ status: 503 });
  });

  it("rejects an unknown region before ever calling fetch", async () => {
    const fetchMock = vi.fn();
    await expect(getDailyForecast("key", "Atlantis", 5, fetchMock as unknown as typeof fetch)).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the forecast endpoint with the region's coordinates, the key, and metric units", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => SAMPLE_RESPONSE,
      text: async () => "",
    })) as unknown as typeof fetch;

    await getDailyForecast("server-secret", "Coimbatore", 3, fetchMock);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = vi.mocked(fetchMock).mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe("https://weather.googleapis.com/v1/forecast/days:lookup");
    expect(parsed.searchParams.get("key")).toBe("server-secret");
    expect(parsed.searchParams.get("location.latitude")).toBe("11.0168");
    expect(parsed.searchParams.get("location.longitude")).toBe("76.9558");
    expect(parsed.searchParams.get("unitsSystem")).toBe("METRIC");
    expect(parsed.searchParams.get("days")).toBe("3");
  });

  it("maps the raw response into the app's clean shape", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => SAMPLE_RESPONSE,
      text: async () => "",
    })) as unknown as typeof fetch;

    const days = await getDailyForecast("key", "Coimbatore", 1, fetchMock);

    expect(days).toEqual([
      {
        dateIso: "2026-07-07",
        minTempC: 24.1,
        maxTempC: 34.5,
        rainProbabilityPercent: 80,
        rainQpfMm: 15,
        windSpeedKph: 18,
        humidityPercent: 72,
        thunderstormProbabilityPercent: 20,
        conditionType: "RAIN_SHOWERS",
      },
    ]);
  });

  it("clamps requested days into the API's 1-10 range", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ forecastDays: [] }),
      text: async () => "",
    })) as unknown as typeof fetch;

    await getDailyForecast("key", "Coimbatore", 99, fetchMock);
    const [url] = vi.mocked(fetchMock).mock.calls[0];
    expect(new URL(String(url)).searchParams.get("days")).toBe("10");
  });

  it("drops a forecast day with no usable date rather than throwing", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ forecastDays: [{ daytimeForecast: {} }] }),
      text: async () => "",
    })) as unknown as typeof fetch;

    await expect(getDailyForecast("key", "Coimbatore", 1, fetchMock)).resolves.toEqual([]);
  });

  it("maps an HTTP failure to a WeatherProxyError with the same status", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 403, text: async () => "quota exceeded" })) as unknown as typeof fetch;
    await expect(getDailyForecast("key", "Coimbatore", 1, fetchMock)).rejects.toBeInstanceOf(WeatherProxyError);
    await expect(getDailyForecast("key", "Coimbatore", 1, fetchMock)).rejects.toMatchObject({ status: 403 });
  });

  it("surfaces an in-body API error even on an HTTP 200", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ error: { code: 400, message: "Invalid location." } }),
      text: async () => "",
    })) as unknown as typeof fetch;
    await expect(getDailyForecast("key", "Coimbatore", 1, fetchMock)).rejects.toMatchObject({ status: 400 });
  });
});
