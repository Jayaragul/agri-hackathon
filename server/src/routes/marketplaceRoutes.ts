/**
 * Marketplace integration routes, mounted under `/api` by `server/src/index.ts`. This is the
 * SHARED backend between two independently-deployed frontends: the FarmConnect marketplace
 * (`marketplace/`, plain static JS, no server of its own) and Krishi Mitra itself.
 *
 * Two-way flow:
 *   1. FarmConnect's `bridge.js` POSTs its new consumer requests here (`/orders/sync`) — this is
 *      what lets Krishi Mitra answer "what's the demand for my crop" with REAL data instead of
 *      nothing.
 *   2. Krishi Mitra POSTs a new listing here (`/listings`) when a farmer says "let's sell it" —
 *      FarmConnect's bridge polls `/listings/new` and turns each into an in-app notification for
 *      every consumer who had an open request for that crop, using FarmConnect's own existing
 *      notification system.
 *
 * CORS is already open globally (`server/src/index.ts`'s `app.use(cors())`), which is what makes
 * this reachable from a marketplace deployment on a different origin.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { DocumentBackend } from "../storage/documentStore";
import { analyzeMarketDemand } from "../services/marketDemand";
import { getMarketplaceStore } from "../services/marketplaceStore";

const MAX_ORDERS_PER_SYNC = 50;

// Restricted to a safe charset ([A-Za-z0-9_-]) rather than the generic "any string up to 100
// chars" a naive schema would allow — `externalId` is used directly as this order's Firestore
// document id, so a value containing "/" or Firestore's reserved "." / ".." would be rejected by
// Firestore anyway, but rejecting it HERE with a clear 400 is better than a confusing 503 from a
// deeper layer. Same discipline as `sessionRoutes.ts`'s `SESSION_ID_RE`.
const EXTERNAL_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

const SyncedOrderSchema = z.object({
  externalId: z.string().regex(EXTERNAL_ID_RE, "externalId must be alphanumeric ( _ - allowed)"),
  productName: z.string().min(1).max(100),
  quantity: z.number().finite().positive(),
  unit: z.string().min(1).max(20),
  price: z.number().finite().positive().nullable(),
  requestedAt: z.number().finite(),
  consumerId: z.string().min(1).max(100).optional(),
  consumerName: z.string().min(1).max(100).optional(),
  region: z.string().min(1).max(100).optional(),
});

const SyncOrdersRequestSchema = z.object({
  orders: z.array(SyncedOrderSchema).min(1).max(MAX_ORDERS_PER_SYNC),
});

const DemandQuerySchema = z.object({
  crop: z.string().min(1).max(100),
  windowDays: z.coerce.number().int().min(1).max(365).optional(),
});

const PublishListingRequestSchema = z.object({
  cropName: z.string().min(1).max(100),
  quantity: z.number().finite().positive(),
  unit: z.string().min(1).max(20),
  price: z.number().finite().positive(),
  farmerName: z.string().min(1).max(100).optional(),
  region: z.string().min(1).max(100).optional(),
});

const NewListingsQuerySchema = z.object({
  since: z.coerce.number().finite().min(0).optional(),
});

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function createMarketplaceRoutes(documents: DocumentBackend): Router {
  const router = Router();
  const store = getMarketplaceStore(documents);

  router.post("/marketplace/orders/sync", async (req: Request, res: Response) => {
    const parsed = SyncOrdersRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body" });
    }
    try {
      let synced = 0;
      for (const order of parsed.data.orders) {
        if (await store.syncOrder(order)) synced += 1;
      }
      return res.status(200).json({ synced, received: parsed.data.orders.length });
    } catch (err) {
      console.error("[marketplaceRoutes] orders/sync failed:", describeError(err));
      return res.status(503).json({ error: "storage_unavailable" });
    }
  });

  router.get("/marketplace/demand", async (req: Request, res: Response) => {
    const parsed = DemandQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query" });
    }
    try {
      const orders = await store.getOrdersForCrop(parsed.data.crop);
      const result = analyzeMarketDemand(parsed.data.crop, orders, parsed.data.windowDays);
      return res.status(200).json(result);
    } catch (err) {
      console.error("[marketplaceRoutes] demand lookup failed:", describeError(err));
      return res.status(503).json({ error: "storage_unavailable" });
    }
  });

  router.post("/marketplace/listings", async (req: Request, res: Response) => {
    const parsed = PublishListingRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_body" });
    }
    try {
      const listing = await store.publishListing(parsed.data);
      return res.status(201).json(listing);
    } catch (err) {
      console.error("[marketplaceRoutes] publish listing failed:", describeError(err));
      return res.status(503).json({ error: "storage_unavailable" });
    }
  });

  router.get("/marketplace/listings/new", async (req: Request, res: Response) => {
    const parsed = NewListingsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_query" });
    }
    try {
      const listings = await store.getListingsSince(parsed.data.since ?? 0);
      return res.status(200).json({ listings });
    } catch (err) {
      console.error("[marketplaceRoutes] listings/new failed:", describeError(err));
      return res.status(503).json({ error: "storage_unavailable" });
    }
  });

  return router;
}
