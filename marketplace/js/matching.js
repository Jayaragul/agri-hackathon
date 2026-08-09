/**
 * Matching — 3 km broadcast engine + inventory reservation logic
 *
 * ARCHITECTURE (Agent model):
 *   When a consumer places a request, it is BROADCAST to ALL farmers
 *   within 3 km — regardless of whether they have listed inventory.
 *   This includes both JSON-seeded farmers and manually registered ones.
 *
 *   Farmers who have listed inventory for the specific product are ranked
 *   first in the results. Others follow as "can supply" candidates.
 */
const Matching = {

  RADIUS_KM: 3,
  RESERVATION_TIMEOUT_MS: 15 * 60 * 1000, // 15 minutes

  // ── Core: Broadcast to all farmers within range ───────────────

  /**
   * Find ALL farmers within 3 km of the consumer.
   * Sorted: farmers with matching listed inventory first, rest after.
   *
   * @param {string} productName - what the consumer wants
   * @param {number} qty
   * @param {{lat, lng}} consumerLocation
   * @returns {{ allFarmers, withInventory, withoutInventory }}
   */
  broadcastRequest(productName, qty, consumerLocation) {
    const allFarmers  = Store.getAllFarmers();
    const allProducts = Store.getProducts();
    const radiusKm    = this.RADIUS_KM;

    const withInventory    = []; // farmers who have listed this product
    const withoutInventory = []; // all other nearby farmers

    for (const farmer of allFarmers) {
      if (!farmer.location || !farmer.location.lat) continue;
      const distance = Geo.haversineDistance(consumerLocation, farmer.location);
      if (distance > radiusKm) continue;

      const formattedDistance = Geo.formatDistance(distance);

      // Check if farmer has a matching listed product
      const matchingProduct = allProducts.find(p =>
        p.farmerId === farmer.id &&
        p.name.toLowerCase().includes(productName.toLowerCase()) &&
        (p.quantity - (p.reservedQty || 0)) >= qty
      );

      if (matchingProduct) {
        withInventory.push({ farmer, distance, formattedDistance, product: matchingProduct, hasListing: true });
      } else {
        withoutInventory.push({ farmer, distance, formattedDistance, product: null, hasListing: false });
      }
    }

    // Sort each group nearest-first
    withInventory.sort((a, b) => a.distance - b.distance);
    withoutInventory.sort((a, b) => a.distance - b.distance);

    return {
      withInventory,
      withoutInventory,
      all: [...withInventory, ...withoutInventory]
    };
  },

  /**
   * Legacy: find farmers who have LISTED the product (for browse-mode cards).
   * Still used on the consumer home "Available Produce" grid.
   */
  findMatches(productName, qty, consumerLocation) {
    const allProducts = Store.getProducts();
    const allUsers    = Store.getUsers();
    const matches     = [];

    for (const product of allProducts) {
      if (!product.name.toLowerCase().includes(productName.toLowerCase())) continue;
      const available = product.quantity - (product.reservedQty || 0);
      if (available < qty) continue;

      const farmer = allUsers.find(u => u.id === product.farmerId && u.role === 'farmer');
      if (!farmer) continue;

      const farmerLoc = (product.location && product.location.lat) ? product.location : farmer.location;
      const distance  = Geo.haversineDistance(consumerLocation, farmerLoc);
      if (distance > this.RADIUS_KM) continue;

      matches.push({ product, farmer, distance, formattedDistance: Geo.formatDistance(distance), availableQty: available });
    }

    return matches.sort((a, b) => a.distance - b.distance);
  },

  // ── Inventory Reservation ─────────────────────────────────────

  reserveStock(productId, qty) {
    const product = Store.getProductById(productId);
    if (!product) return false;
    const available = product.quantity - (product.reservedQty || 0);
    if (available < qty) return false;
    Store.updateProduct(productId, { reservedQty: (product.reservedQty || 0) + qty });
    return true;
  },

  releaseReservation(productId, qty) {
    const product = Store.getProductById(productId);
    if (!product) return;
    Store.updateProduct(productId, { reservedQty: Math.max(0, (product.reservedQty || 0) - qty) });
  },

  completeDeduction(productId, qty) {
    const product = Store.getProductById(productId);
    if (!product) return;
    Store.updateProduct(productId, {
      quantity:    Math.max(0, product.quantity - qty),
      reservedQty: Math.max(0, (product.reservedQty || 0) - qty)
    });
  },

  // ── Order State Transitions ───────────────────────────────────

  /**
   * Farmer accepts a broadcast request.
   * - If farmer has listed inventory → reserves from their listing
   * - If farmer has NO listed inventory → accepts as a pledge (no stock deduction yet)
   * First farmer to accept wins.
   */
  farmerAccept(orderId, farmerId, productId) {
    const order = Store.getOrderById(orderId);
    if (!order) return { success: false, message: 'Order not found.' };
    if (order.status !== 'matched') {
      return { success: false, message: 'This request has already been accepted by another farmer.' };
    }

    const farmer  = Store.getUserById(farmerId);
    let   product = productId ? Store.getProductById(productId) : null;

    // If farmer has a listed product, reserve its stock
    if (product) {
      const reserved = this.reserveStock(productId, order.requestedQty);
      if (!reserved) return { success: false, message: 'Insufficient stock in your listed inventory.' };
    }
    // else: farmer accepts as a pledge — they don't have a listing but can supply

    const updatedOrder = Store.updateOrder(orderId, {
      status:          'accepted',
      farmerId,
      farmerName:      farmer ? farmer.name : 'Farmer',
      productId:       product ? productId : null,
      productName:     product ? product.name : order.productName,
      price:           product ? product.price : order.offeredPrice || null,
      farmerLocation:  farmer ? farmer.location : null,
      farmerHasListing: !!product,
      timestamps:      { ...order.timestamps, accepted: Date.now() }
    });

    return { success: true, order: updatedOrder };
  },

  consumerConfirm(orderId) {
    const order = Store.getOrderById(orderId);
    if (!order || order.status !== 'accepted') {
      return { success: false, message: 'Order cannot be confirmed at this stage.' };
    }
    const updatedOrder = Store.updateOrder(orderId, {
      status: 'confirmed',
      timestamps: { ...order.timestamps, confirmed: Date.now() }
    });
    return { success: true, order: updatedOrder };
  },

  markReady(orderId) {
    const order = Store.getOrderById(orderId);
    if (!order) return { success: false };
    const updatedOrder = Store.updateOrder(orderId, {
      status: 'ready',
      timestamps: { ...order.timestamps, ready: Date.now() }
    });
    return { success: true, order: updatedOrder };
  },

  completeOrder(orderId) {
    const order = Store.getOrderById(orderId);
    if (!order) return { success: false };
    if (order.productId) this.completeDeduction(order.productId, order.requestedQty);
    const updatedOrder = Store.updateOrder(orderId, {
      status: 'completed',
      timestamps: { ...order.timestamps, completed: Date.now() }
    });
    return { success: true, order: updatedOrder };
  },

  cancelOrder(orderId) {
    const order = Store.getOrderById(orderId);
    if (!order) return { success: false };
    if (order.productId && order.requestedQty && ['accepted', 'confirmed', 'ready'].includes(order.status)) {
      this.releaseReservation(order.productId, order.requestedQty);
    }
    const updatedOrder = Store.updateOrder(orderId, {
      status: 'cancelled',
      timestamps: { ...order.timestamps, cancelled: Date.now() }
    });
    return { success: true, order: updatedOrder };
  }
};
