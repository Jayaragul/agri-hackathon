/**
 * Frontend client for the FarmConnect marketplace integration
 * (`server/src/routes/marketplaceRoutes.ts`) — this server IS the shared backend for both Krishi
 * Mitra and the independently-deployed `marketplace/` static app, since FarmConnect has no
 * server of its own. See `marketplace/js/bridge.js` for the other side of this exchange.
 *
 * Silently-degrading by design, same posture as `weatherClient.ts`: a farmer never taps a button
 * that only exists to check the marketplace is reachable — `getMarketDemand` and `publishListing`
 * both degrade to an honest "no data"/failure shape on any network issue, since the marketplace
 * integration is advisory, not something the rest of the app depends on to function.
 */
import type { DemandTier } from "./types";

// Direct `import.meta.env.KEY` access, not an aliased `const meta = import.meta; meta.env`
// indirection — see the comment on `resolveEnvSource` in `services/ai/runtime/harnessConfig.ts`
// for why the indirect form silently resolves to nothing under Vite's dev-mode client injection.
function readApiBase(): string {
  try {
    const raw = import.meta.env.VITE_API_BASE_URL;
    return typeof raw === "string" ? raw.trim().replace(/\/$/, "") : "";
  } catch {
    return "";
  }
}

export interface MarketDemand {
  cropName: string;
  windowDays: number;
  requestCount: number;
  totalQuantityRequested: number;
  unit: string | null;
  suggestedPricePerUnit: number | null;
  demandTier: DemandTier;
}

export interface PublishedListing {
  id: string;
  cropName: string;
  quantity: number;
  unit: string;
  price: number;
  farmerName?: string;
  region?: string;
  createdAt: number;
  matchedRequesterCount: number;
}

/** Real consumer-demand data from the marketplace for one crop. Never throws — a network failure or unreachable marketplace backend resolves to a "no-data" shape, the same honest answer as genuinely zero requests. */
export async function getMarketDemand(cropName: string, windowDays?: number): Promise<MarketDemand> {
  const fallback: MarketDemand = {
    cropName,
    windowDays: windowDays ?? 30,
    requestCount: 0,
    totalQuantityRequested: 0,
    unit: null,
    suggestedPricePerUnit: null,
    demandTier: "no-data",
  };
  try {
    const params = new URLSearchParams({ crop: cropName });
    if (windowDays) params.set("windowDays", String(windowDays));
    const response = await fetch(`${readApiBase()}/api/marketplace/demand?${params.toString()}`);
    if (!response.ok) return fallback;
    const body = (await response.json()) as Partial<MarketDemand>;
    return {
      cropName: body.cropName ?? cropName,
      windowDays: body.windowDays ?? fallback.windowDays,
      requestCount: body.requestCount ?? 0,
      totalQuantityRequested: body.totalQuantityRequested ?? 0,
      unit: body.unit ?? null,
      suggestedPricePerUnit: body.suggestedPricePerUnit ?? null,
      demandTier: body.demandTier ?? "no-data",
    };
  } catch {
    return fallback;
  }
}

/**
 * "Let's sell it" — publishes a listing to the shared marketplace backend. FarmConnect's bridge
 * polls for these and notifies every local consumer with a matching open request. Returns `null`
 * on any failure (network, marketplace backend unreachable) rather than throwing — the caller
 * must treat that as "could not publish right now," never silently assume it worked.
 */
export async function publishListing(input: {
  cropName: string;
  quantity: number;
  unit: string;
  price: number;
  farmerName?: string;
  region?: string;
}): Promise<PublishedListing | null> {
  try {
    const response = await fetch(`${readApiBase()}/api/marketplace/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) return null;
    return (await response.json()) as PublishedListing;
  } catch {
    return null;
  }
}
