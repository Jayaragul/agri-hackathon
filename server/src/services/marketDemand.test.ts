import { describe, expect, it } from "vitest";
import { analyzeMarketDemand, type MarketplaceOrderRecord } from "./marketDemand";

const NOW = 1_735_000_000_000; // fixed reference instant
const DAY_MS = 24 * 60 * 60 * 1000;

function order(overrides: Partial<MarketplaceOrderRecord> = {}): MarketplaceOrderRecord {
  return {
    productName: "Tomato",
    quantity: 2,
    unit: "kg",
    price: 30,
    requestedAt: NOW,
    ...overrides,
  };
}

describe("analyzeMarketDemand", () => {
  it("returns a no-data tier with zeroed counts for an empty order list", () => {
    const result = analyzeMarketDemand("Tomato", [], 30, NOW);
    expect(result).toMatchObject({
      requestCount: 0,
      totalQuantityRequested: 0,
      unit: null,
      suggestedPricePerUnit: null,
      demandTier: "no-data",
    });
  });

  it("never throws on malformed input", () => {
    expect(() => analyzeMarketDemand("Tomato", null as unknown as MarketplaceOrderRecord[], 30, NOW)).not.toThrow();
  });

  it("excludes requests older than the window", () => {
    const result = analyzeMarketDemand(
      "Tomato",
      [order({ requestedAt: NOW - 45 * DAY_MS })],
      30,
      NOW
    );
    expect(result.requestCount).toBe(0);
  });

  it("sums quantity and reports the most common unit", () => {
    const result = analyzeMarketDemand(
      "Tomato",
      [order({ quantity: 2, unit: "kg" }), order({ quantity: 3, unit: "kg" }), order({ quantity: 1, unit: "piece" })],
      30,
      NOW
    );
    expect(result.totalQuantityRequested).toBe(6);
    expect(result.unit).toBe("kg");
  });

  it("suggests the median of requests that carried a real price, ignoring nulls", () => {
    const result = analyzeMarketDemand(
      "Tomato",
      [order({ price: 20 }), order({ price: 30 }), order({ price: 40 }), order({ price: null })],
      30,
      NOW
    );
    expect(result.suggestedPricePerUnit).toBe(30);
  });

  it("classifies demand tiers by request-count thresholds", () => {
    const many = (n: number) => Array.from({ length: n }, () => order());
    expect(analyzeMarketDemand("Tomato", many(1), 30, NOW).demandTier).toBe("low");
    expect(analyzeMarketDemand("Tomato", many(3), 30, NOW).demandTier).toBe("medium");
    expect(analyzeMarketDemand("Tomato", many(8), 30, NOW).demandTier).toBe("high");
  });

  it("uses a default 30-day window when none is supplied", () => {
    const result = analyzeMarketDemand("Tomato", [order()], undefined, NOW);
    expect(result.windowDays).toBe(30);
  });
});
