/**
 * Bridge — FarmConnect's ambassador to Krishi Mitra's shared backend
 * ─────────────────────────────────────────────────────────────────
 *
 * FarmConnect has no backend of its own (everything lives in `localStorage`, see `store.js`).
 * Krishi Mitra is a separate, independently-deployed app that needs REAL demand data (what
 * consumers are actually requesting) to answer a farmer's "what's the demand for my crop", and
 * needs a way to tell FarmConnect "a farmer just decided to sell — notify whoever asked for it."
 *
 * This file is the two-way seam between them, in the SAME JSON-schema-tagged, console-logged
 * style `agent.js` already uses for its own in-app broadcast, extended with a real cross-origin
 * leg:
 *
 *   OUT  FarmConnect:KrishiMitraOrderSync:v1   — every new consumer request, fire-and-forget
 *   IN   FarmConnect:KrishiMitraListing:v1     — a farmer's "let's sell it" listing, polled in
 *
 * Fully optional: with `Config.KRISHI_MITRA_API_BASE` unset, every method here is a silent no-op
 * and FarmConnect behaves exactly as it did with no Krishi Mitra integration at all.
 */
const Bridge = {
  POLL_INTERVAL_MS: 20_000,
  LAST_SEEN_KEY: 'fc_km_last_seen_listing',
  _pollTimer: null,

  _apiBase() {
    return (typeof Config !== 'undefined' && Config.bridgeEnabled()) ? Config.KRISHI_MITRA_API_BASE.replace(/\/$/, '') : null;
  },

  _lastSeen() {
    const raw = localStorage.getItem(this.LAST_SEEN_KEY);
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  },

  _setLastSeen(ts) {
    localStorage.setItem(this.LAST_SEEN_KEY, String(ts));
  },

  // ── OUT: order → Krishi Mitra (demand signal) ──────────────────

  /**
   * Push one newly-created order to Krishi Mitra so its General Farm Advisor can answer "what's
   * the demand for my crop" with real numbers. Fire-and-forget — never blocks or throws; a
   * farmer/consumer action in FarmConnect must never wait on, or fail because of, this sync.
   */
  async pushOrder(order) {
    const base = this._apiBase();
    if (!base || !order) return;

    const payload = {
      schema: 'FarmConnect:KrishiMitraOrderSync:v1',
      orders: [{
        externalId: order.id,
        productName: order.productName,
        quantity: order.requestedQty,
        unit: order.unit || 'piece',
        price: typeof order.price === 'number' ? order.price : null,
        requestedAt: order.createdAt || Date.now(),
        consumerId: order.consumerId,
        consumerName: order.consumerName,
        region: order.consumerLocation && order.consumerLocation.label ? order.consumerLocation.label : undefined,
      }],
    };

    try {
      console.log('%c→ Bridge: syncing order to Krishi Mitra', 'color:#2563EB;font-weight:bold', payload);
      await fetch(`${base}/api/marketplace/orders/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: payload.orders }),
      });
    } catch (err) {
      console.warn('Bridge: order sync failed (non-fatal, FarmConnect keeps working locally)', err);
    }
  },

  // ── IN: Krishi Mitra listing → local notifications ──────────────

  /**
   * Poll for new "let's sell it" listings published from Krishi Mitra. Each one becomes:
   *   1. A product visible on the consumer's "Browse Produce" grid (marked krishiMitraListing).
   *   2. An in-app notification to every LOCAL consumer who has an order (any recency, any
   *      status) for a matching product name — "whoever asked for it gets notified," per spec,
   *      not a distance broadcast (Krishi Mitra doesn't necessarily know farmer lat/lng).
   */
  async pollNewListings() {
    const base = this._apiBase();
    if (!base) return;

    let listings;
    try {
      const since = this._lastSeen();
      const res = await fetch(`${base}/api/marketplace/listings/new?since=${since}`);
      if (!res.ok) return;
      const body = await res.json();
      listings = Array.isArray(body.listings) ? body.listings : [];
    } catch (err) {
      console.warn('Bridge: listing poll failed (non-fatal)', err);
      return;
    }

    if (listings.length === 0) return;
    console.log(`%c← Bridge: ${listings.length} new listing(s) from Krishi Mitra`, 'color:#2D7A4F;font-weight:bold', listings);

    let maxSeen = this._lastSeen();
    for (const listing of listings) {
      this._applyListing(listing);
      if (listing.createdAt > maxSeen) maxSeen = listing.createdAt;
    }
    this._setLastSeen(maxSeen);
  },

  _applyListing(listing) {
    const guide = (typeof Agent !== 'undefined') ? Agent._getGuide(listing.cropName) : { emoji: '🌿', category: 'Vegetables' };

    // Krishi Mitra farmers aren't FarmConnect users — represent them with a synthetic farmer id
    // so the product still renders normally in the consumer grid (name shown, no fake location
    // claims — omitting `location` just means it won't appear in a distance-filtered view, which
    // is honest: we don't actually know where this farmer is).
    const farmerId = `km-${listing.id}`;
    Store.addProduct({
      farmerId,
      farmerName: listing.farmerName || 'A Krishi Mitra farmer',
      name: listing.cropName,
      category: guide.category,
      quantity: listing.quantity,
      unit: listing.unit,
      price: listing.price,
      emoji: guide.emoji,
      krishiMitraListing: true,
      krishiMitraListingId: listing.id,
    });

    // Notify every local consumer who has ever requested a matching product — the "whoever asks
    // that veg needs to get notified" flow.
    const needle = listing.cropName.trim().toLowerCase();
    const consumerIds = new Set(
      Store.getOrders()
        .filter((o) => {
          const hay = (o.productName || '').trim().toLowerCase();
          return hay.includes(needle) || needle.includes(hay);
        })
        .map((o) => o.consumerId)
        .filter(Boolean)
    );

    for (const consumerId of consumerIds) {
      NotificationSystem.add(
        consumerId,
        `🌾 ${listing.farmerName || 'A farmer'} is now selling ${listing.quantity} ${listing.unit} of ${listing.cropName} at ₹${listing.price}/${listing.unit}. Tap to view.`,
        'push',
        null
      );
    }
    if (consumerIds.size > 0) NotificationSystem.updateBadge();
  },

  // ── Lifecycle ────────────────────────────────────────────────────

  start() {
    if (!this._apiBase()) return; // Bridge disabled — FarmConnect runs standalone.
    if (this._pollTimer) return; // Already running.
    void this.pollNewListings();
    this._pollTimer = setInterval(() => this.pollNewListings(), this.POLL_INTERVAL_MS);
  },

  stop() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._pollTimer = null;
  },
};
