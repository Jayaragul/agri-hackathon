/**
 * Zod-validated shapes and Firestore collection names for the FarmConnect marketplace
 * integration — the single source of truth for its persisted layout.
 *
 * Firestore-backed (`documentStore.ts`), NOT `bucketStore.ts`'s GCS JSON blobs, as of this
 * revision. The original design kept one shared JSON array per collection
 * (`marketplace/orders/index.json`) that every write had to read-modify-write — safe for a
 * single instance, but a real race under Cloud Run's default autoscaling (two instances syncing
 * orders at once could clobber each other's index update). Firestore gives every order/listing
 * its OWN document, so concurrent writes from different instances touch different documents —
 * nothing to race — and `DocumentBackend.createIfAbsent()` makes the "don't double-count a
 * retried sync" idempotency check atomic instead of a client-side check-then-write gap.
 *
 * Each document IS the permanent record — unlike the old GCS design, there is no separate
 * "bounded index vs. unbounded dated record" split to reason about; a query's `.limit()` is
 * purely a read-cost control, never a deletion.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Orders — collection "marketplace_orders", document id = externalId
// ---------------------------------------------------------------------------

export const MARKETPLACE_ORDERS_COLLECTION = "marketplace_orders";

export const SyncedOrderRecordSchema = z.object({
  /** The marketplace's own order id — ALSO this document's Firestore doc id, which is what makes de-duplication atomic. */
  externalId: z.string().min(1).max(100),
  productName: z.string().min(1).max(100),
  quantity: z.number().finite().positive(),
  unit: z.string().min(1).max(20),
  price: z.number().finite().positive().nullable(),
  requestedAt: z.number().finite(),
  consumerId: z.string().min(1).max(100).optional(),
  consumerName: z.string().min(1).max(100).optional(),
  region: z.string().min(1).max(100).optional(),
  /** When THIS server persisted it — distinct from `requestedAt`, which the marketplace controls. */
  syncedAt: z.number().finite(),
});

export type SyncedOrderRecord = z.infer<typeof SyncedOrderRecordSchema>;

// ---------------------------------------------------------------------------
// Listings — collection "marketplace_listings", document id = a server-generated uuid
// ---------------------------------------------------------------------------

export const MARKETPLACE_LISTINGS_COLLECTION = "marketplace_listings";

export const FarmerListingRecordSchema = z.object({
  id: z.string().min(1),
  cropName: z.string().min(1).max(100),
  quantity: z.number().finite().positive(),
  unit: z.string().min(1).max(20),
  price: z.number().finite().positive(),
  farmerName: z.string().min(1).max(100).optional(),
  region: z.string().min(1).max(100).optional(),
  createdAt: z.number().finite(),
  /** How many distinct recent requesters for this crop existed at publish time — informational, shown back to the farmer. */
  matchedRequesterCount: z.number().finite(),
});

export type FarmerListingRecord = z.infer<typeof FarmerListingRecordSchema>;

// Read-cost caps for the fuzzy/poll queries below — NOT a data cap (Firestore keeps every
// document; these only bound how many the demand-lookup and bridge-poll queries fetch per call).
export const ORDER_QUERY_LIMIT = 5_000;
export const LISTING_POLL_LIMIT = 1_000;
