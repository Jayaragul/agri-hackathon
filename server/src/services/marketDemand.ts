/**
 * Deterministic demand-analysis engine for the FarmConnect marketplace integration.
 *
 * Same "engine decides, AI explains" discipline as every other engine in this app
 * (`src/engine/**`): given the raw consumer requests synced in from FarmConnect for one crop,
 * this computes request volume, quantity demanded, and a suggested price PURELY from that data —
 * no model call, nothing invented. `answer-farm-question`'s `get_market_demand` tool (see
 * `src/services/ai/runtime/farmAdvisorTools.ts`) only ever relays what this function actually
 * returns; the AI layer explains the number, it never originates one.
 */

export interface MarketplaceOrderRecord {
  productName: string;
  quantity: number;
  unit: string;
  /** The price a consumer offered, or a farmer's listed price at request time — `null` when unknown (a broadcast request has no price until a farmer quotes one). */
  price: number | null;
  requestedAt: number;
}

export type DemandTier = "no-data" | "low" | "medium" | "high";

export interface MarketDemandResult {
  cropName: string;
  windowDays: number;
  requestCount: number;
  totalQuantityRequested: number;
  /** Unit of `totalQuantityRequested` — the most common unit among matching requests, or `null` if none. */
  unit: string | null;
  /** Median of the requests that carried a price — the honest "appropriate price" figure, never a guess when nothing is known. */
  suggestedPricePerUnit: number | null;
  demandTier: DemandTier;
}

const DEFAULT_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Request-count thresholds for the demand tier — a plain, documented heuristic, not a market model. */
const TIER_THRESHOLDS: Array<{ tier: DemandTier; minRequests: number }> = [
  { tier: "high", minRequests: 8 },
  { tier: "medium", minRequests: 3 },
  { tier: "low", minRequests: 1 },
];

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mostCommonUnit(orders: MarketplaceOrderRecord[]): string | null {
  const counts = new Map<string, number>();
  for (const o of orders) {
    if (!o.unit) continue;
    counts.set(o.unit, (counts.get(o.unit) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [unit, count] of counts) {
    if (count > bestCount) {
      best = unit;
      bestCount = count;
    }
  }
  return best;
}

function resolveTier(requestCount: number): DemandTier {
  for (const { tier, minRequests } of TIER_THRESHOLDS) {
    if (requestCount >= minRequests) return tier;
  }
  return "no-data";
}

/**
 * Analyse demand for one crop from its recent synced order history.
 *
 * `orders` should already be filtered to the crop of interest (fuzzy name matching, if any, is
 * the caller's job — this function only does the arithmetic). Never throws: empty/malformed
 * input just produces a `"no-data"` tier with zeroed counts, the honest answer when nothing has
 * been requested yet.
 */
export function analyzeMarketDemand(
  cropName: string,
  orders: MarketplaceOrderRecord[],
  windowDays: number = DEFAULT_WINDOW_DAYS,
  now: number = Date.now()
): MarketDemandResult {
  const window = Number.isFinite(windowDays) && windowDays > 0 ? windowDays : DEFAULT_WINDOW_DAYS;
  const cutoff = now - window * DAY_MS;
  const recent = Array.isArray(orders) ? orders.filter((o) => o && o.requestedAt >= cutoff) : [];

  const totalQuantityRequested = recent.reduce((sum, o) => sum + (Number.isFinite(o.quantity) ? o.quantity : 0), 0);
  const prices = recent.map((o) => o.price).filter((p): p is number => typeof p === "number" && Number.isFinite(p) && p > 0);

  return {
    cropName,
    windowDays: window,
    requestCount: recent.length,
    totalQuantityRequested,
    unit: mostCommonUnit(recent),
    suggestedPricePerUnit: median(prices),
    demandTier: resolveTier(recent.length),
  };
}
