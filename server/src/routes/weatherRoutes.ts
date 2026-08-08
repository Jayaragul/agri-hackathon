/**
 * Weather routes, mounted under `/api` by `server/src/index.ts`. Same shape as `voiceRoutes.ts`:
 * the frontend never sees `GOOGLE_WEATHER_API_KEY`, only ever calling this server's own routes.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getDailyForecast, isKnownRegion, WeatherProxyError } from "../services/weatherProxy";
import { resolveWeatherApiKey } from "../services/env";

const ForecastQuerySchema = z.object({
  region: z.string().min(1).max(50),
  days: z.coerce.number().int().min(1).max(10).optional(),
});

export function createWeatherRoutes(): Router {
  const router = Router();

  router.get("/weather/status", (_req: Request, res: Response) => {
    res.status(200).json({ configured: resolveWeatherApiKey().length > 0 });
  });

  router.get("/weather/forecast", async (req: Request, res: Response) => {
    const parsed = ForecastQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query" });
    }
    if (!isKnownRegion(parsed.data.region)) {
      return res.status(400).json({ error: `Unknown region "${parsed.data.region}".` });
    }

    try {
      const days = await getDailyForecast(resolveWeatherApiKey(), parsed.data.region, parsed.data.days);
      return res.status(200).json({ days });
    } catch (err) {
      const status = err instanceof WeatherProxyError ? err.status : 500;
      const message = err instanceof Error ? err.message : "Unexpected error fetching the forecast.";
      if (status >= 500) console.error("[weatherRoutes] forecast lookup failed:", message);
      return res.status(status).json({ error: message });
    }
  });

  return router;
}
