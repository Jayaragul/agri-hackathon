/**
 * Search-grounded market price lookup.
 *
 * ADVISORY DISPLAY DATA ONLY. `financialEngine` keeps using `crop.marketPricePerKg` from the
 * bundled dataset for every cost, revenue, profit, ROI and break-even figure, so the numbers
 * on the financial screen stay deterministic and reproducible. A live price found here is
 * shown next to those figures, with its sources, never in place of them. Nothing in this file
 * writes to the store or feeds the engine.
 *
 * The task is grounded, which means no provider-side response schema, which means the model's
 * output is less constrained than the other three tasks. `sanitisePrice` therefore re-checks
 * the parsed result: it forces the currency, drops a non-finite or non-positive price, strips
 * any source URL that is not plain http(s), and flags a quote that is wildly out of line with
 * the dataset figure instead of presenting it as fact.
 */

import type { Crop } from "../../../domain/models/models";
import type { AiOutcome } from "../contracts/aiTypes";
import type { MarketPrice } from "../contracts/aiSchemas";
import type { AiHarness } from "../runtime/AiHarness";
import {
  createMarketPriceTask,
  createDatasetAveragePrice,
} from "../tasks/marketPriceTask";

/** A quote further than this multiple from the dataset average is reported but flagged. */
const IMPLAUSIBLE_RATIO = 10;

/** Keep only URLs a browser can safely render as a citation link. */
function sanitiseUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  const out: string[] = [];
  for (const url of urls) {
    if (typeof url !== "string") continue;
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) continue;
    if (out.indexOf(trimmed) === -1) out.push(trimmed);
  }
  return out;
}

/** Harness-backed market price lookup. */
export class MarketPriceService {
  private readonly harness: AiHarness;
  private readonly task = createMarketPriceTask();

  constructor(harness: AiHarness) {
    this.harness = harness;
  }

  /**
   * Look up the current mandi/wholesale price for a crop near a region.
   *
   * Always resolves. On any failure the outcome carries the dataset average at low confidence,
   * labelled as such, which is exactly what the app displayed before this feature existed.
   */
  public async getPrice(crop: Crop, region: string): Promise<AiOutcome<MarketPrice>> {
    const input = { crop, region };

    let outcome: AiOutcome<MarketPrice>;
    try {
      outcome = await this.harness.run(this.task, input);
    } catch {
      // `AiHarness.run` is contractually non-rejecting; this guards a broken injected double.
      return {
        data: createDatasetAveragePrice(input),
        source: "local",
        latencyMs: 0,
        degraded: true,
        validationRepaired: false,
        notes: ["AI harness was unavailable; showing the dataset average instead."],
      };
    }

    return this.sanitisePrice(outcome, crop);
  }

  /** Post-validation guard rails for the one task with no provider-side response schema. */
  private sanitisePrice(
    outcome: AiOutcome<MarketPrice>,
    crop: Crop
  ): AiOutcome<MarketPrice> {
    const data = outcome.data;
    const notes = Array.isArray(outcome.notes) ? outcome.notes.slice() : [];

    let pricePerKg = data?.pricePerKg ?? null;
    if (pricePerKg !== null && (!Number.isFinite(pricePerKg) || pricePerKg <= 0)) {
      notes.push("Discarded an unusable price value from the model response.");
      pricePerKg = null;
    }

    const datasetPrice = crop?.marketPricePerKg;
    if (
      pricePerKg !== null &&
      typeof datasetPrice === "number" &&
      Number.isFinite(datasetPrice) &&
      datasetPrice > 0
    ) {
      const ratio = pricePerKg / datasetPrice;
      if (ratio > IMPLAUSIBLE_RATIO || ratio < 1 / IMPLAUSIBLE_RATIO) {
        notes.push(
          "This quote is far from the app's stored average for this crop. Check the source before relying on it."
        );
      }
    }

    const currency =
      typeof data?.currency === "string" && data.currency.trim().length > 0
        ? data.currency.trim().toUpperCase()
        : "INR";

    const groundingUrls = Array.isArray(outcome.groundingUrls)
      ? outcome.groundingUrls
      : [];
    const sourceUrls = sanitiseUrls([...sanitiseUrls(data?.sourceUrls), ...groundingUrls]);

    if (pricePerKg !== null && sourceUrls.length === 0) {
      notes.push("No source link was returned with this price.");
    }

    return {
      ...outcome,
      data: {
        ...data,
        pricePerKg,
        currency,
        sourceUrls,
      },
      notes,
    };
  }
}
