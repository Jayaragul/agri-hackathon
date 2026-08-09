/**
 * Firestore-backed store for the FarmConnect marketplace integration — the shared backend both
 * the marketplace app's sync bridge and Krishi Mitra's own frontend read/write, since the
 * marketplace itself has no server of its own (it runs entirely on `localStorage`).
 *
 * Persisted through `DocumentBackend` (`storage/documentStore.ts`) — Firestore when
 * `FIRESTORE_ENABLED=true`, an in-process map otherwise. See `storage/marketplaceTypes.ts` for
 * why this moved off `bucketStore.ts`'s GCS JSON-blob design: per-document writes are what
 * actually remove the multi-instance write race a shared JSON array could not avoid.
 *
 * Still not a system of record for real transactions (`marketDemand.ts`'s header explains the
 * broader posture) — this is demand-signal data, not a durable order ledger — but data loss on
 * restart and cross-instance blindness are no longer part of that tradeoff; only "this is
 * advisory demand data, not a payments/inventory system" still is.
 */

import type { DocumentBackend } from "../storage/documentStore";
import {
  FarmerListingRecordSchema,
  LISTING_POLL_LIMIT,
  MARKETPLACE_LISTINGS_COLLECTION,
  MARKETPLACE_ORDERS_COLLECTION,
  ORDER_QUERY_LIMIT,
  SyncedOrderRecordSchema,
  type FarmerListingRecord,
  type SyncedOrderRecord,
} from "../storage/marketplaceTypes";

export type SyncedOrder = SyncedOrderRecord;
export type FarmerListing = FarmerListingRecord;

function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // Fall through.
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class MarketplaceStore {
  constructor(private readonly documents: DocumentBackend) {}

  /**
   * Idempotent on `externalId` — a retried sync (network hiccup on the bridge's side) never
   * double-counts demand. `createIfAbsent` is atomic at the Firestore level, so two instances
   * racing to sync the same order can never both succeed. Throws on a genuine storage failure
   * (mirrors `sessionRoutes.ts`'s "never silently pretend to have saved" rule) — the route layer
   * catches and reports 503.
   */
  async syncOrder(input: Omit<SyncedOrder, "syncedAt">): Promise<boolean> {
    const parsedInput = SyncedOrderRecordSchema.omit({ syncedAt: true }).safeParse(input);
    if (!parsedInput.success) return false;

    const record: SyncedOrder = { ...parsedInput.data, syncedAt: Date.now() };
    return this.documents.createIfAbsent(MARKETPLACE_ORDERS_COLLECTION, record.externalId, record);
  }

  /** Fuzzy (case-insensitive substring, either direction) match on product name — mirrors the marketplace's own `Matching.findMatches` convention. Firestore has no substring query, so this still filters in-process after a bounded fetch. */
  async getOrdersForCrop(cropName: string): Promise<SyncedOrder[]> {
    const needle = cropName.trim().toLowerCase();
    if (!needle) return [];
    const orders = await this.documents.list<SyncedOrder>(MARKETPLACE_ORDERS_COLLECTION, {
      orderByField: "syncedAt",
      direction: "desc",
      limit: ORDER_QUERY_LIMIT,
    });
    return orders.filter((o) => {
      const hay = o.productName.trim().toLowerCase();
      return hay.includes(needle) || needle.includes(hay);
    });
  }

  async publishListing(input: Omit<FarmerListing, "id" | "createdAt" | "matchedRequesterCount">): Promise<FarmerListing> {
    const matchedRequesterCount = new Set(
      (await this.getOrdersForCrop(input.cropName)).filter((o) => o.consumerId).map((o) => o.consumerId)
    ).size;

    const listing: FarmerListing = { ...input, id: uuid(), createdAt: Date.now(), matchedRequesterCount };
    FarmerListingRecordSchema.parse(listing); // defensive — a shape bug here must fail loudly, not silently corrupt Firestore data
    await this.documents.set(MARKETPLACE_LISTINGS_COLLECTION, listing.id, listing);
    return listing;
  }

  /** New listings since a timestamp, for the marketplace bridge's poll — newest last, so the bridge can just remember the latest `createdAt` it has already seen. */
  async getListingsSince(sinceMs: number): Promise<FarmerListing[]> {
    return this.documents.list<FarmerListing>(MARKETPLACE_LISTINGS_COLLECTION, {
      where: [["createdAt", ">", sinceMs]],
      orderByField: "createdAt",
      direction: "asc",
      limit: LISTING_POLL_LIMIT,
    });
  }
}

let singleton: MarketplaceStore | null = null;

/** Lazy singleton, same pattern as `services/ai/index.ts`'s other shared stores. */
export function getMarketplaceStore(documents: DocumentBackend): MarketplaceStore {
  if (singleton === null) singleton = new MarketplaceStore(documents);
  return singleton;
}

/** Test-only: drop all state and force a fresh store on the next `getMarketplaceStore()` call. */
export function resetMarketplaceStore(): void {
  singleton = null;
}
