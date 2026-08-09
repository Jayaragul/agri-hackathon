/**
 * Agent.js — Agent-to-Agent (A2A) Request / Response Broker
 * ─────────────────────────────────────────────────────────────────
 *
 * HOW IT WORKS:
 *
 *   1. Consumer places a request → _sendRequest() calls Agent.dispatchRequest(order)
 *   2. Agent.dispatchRequest() builds a REQUEST JSON payload (schema v1)
 *   3. Every farmer agent within 3 km receives this JSON
 *   4. Each agent checks its specialties[] from FARMERS_DATA
 *   5. If the product matches → agent responds with a RESPONSE JSON
 *   6. Agent auto-creates a product listing in the store (if not already listed)
 *   7. Consumer dashboard automatically shows the new agent-created listings
 *
 * JSON SCHEMAS:
 *
 *   REQUEST  → FarmConnect:AgentRequest:v1
 *   RESPONSE ← FarmConnect:AgentResponse:v1
 *
 * All JSON exchanges are logged to the browser console for transparency.
 * ─────────────────────────────────────────────────────────────────
 */
const Agent = {

  // ── Produce Price & Unit Guide ────────────────────────────────
  // Used when a farmer agent auto-creates a listing (no manual price set)

  PRODUCE_GUIDE: {
    'Drumstick':       { price: 10,  unit: 'piece', emoji: '🥦', category: 'Vegetables',   qtyRange: [5, 20] },
    'Moringa':         { price: 10,  unit: 'piece', emoji: '🌿', category: 'Vegetables',   qtyRange: [5, 20] },
    'Tomato':          { price: 25,  unit: 'kg',    emoji: '🍅', category: 'Vegetables',   qtyRange: [2, 15] },
    'Spinach':         { price: 15,  unit: 'bunch', emoji: '🥬', category: 'Leafy Greens', qtyRange: [3, 10] },
    'Fenugreek':       { price: 12,  unit: 'bunch', emoji: '🌿', category: 'Leafy Greens', qtyRange: [3, 10] },
    'Coriander':       { price: 10,  unit: 'bunch', emoji: '🌿', category: 'Leafy Greens', qtyRange: [5, 15] },
    'Mint':            { price: 8,   unit: 'bunch', emoji: '🌿', category: 'Leafy Greens', qtyRange: [5, 15] },
    'Brinjal':         { price: 35,  unit: 'kg',    emoji: '🍆', category: 'Vegetables',   qtyRange: [2, 8]  },
    'Onion':           { price: 25,  unit: 'kg',    emoji: '🧅', category: 'Vegetables',   qtyRange: [5, 20] },
    'Potato':          { price: 20,  unit: 'kg',    emoji: '🥔', category: 'Vegetables',   qtyRange: [5, 25] },
    'Carrot':          { price: 40,  unit: 'kg',    emoji: '🥕', category: 'Vegetables',   qtyRange: [2, 8]  },
    'Radish':          { price: 30,  unit: 'kg',    emoji: '🌱', category: 'Vegetables',   qtyRange: [2, 8]  },
    'Beetroot':        { price: 35,  unit: 'kg',    emoji: '🫐', category: 'Vegetables',   qtyRange: [2, 6]  },
    'Okra':            { price: 40,  unit: 'kg',    emoji: '🌿', category: 'Vegetables',   qtyRange: [1, 5]  },
    'Ladies Finger':   { price: 40,  unit: 'kg',    emoji: '🌿', category: 'Vegetables',   qtyRange: [1, 5]  },
    'Capsicum':        { price: 60,  unit: 'kg',    emoji: '🫑', category: 'Vegetables',   qtyRange: [1, 5]  },
    'Cucumber':        { price: 20,  unit: 'kg',    emoji: '🥒', category: 'Vegetables',   qtyRange: [2, 8]  },
    'Bitter Gourd':    { price: 45,  unit: 'kg',    emoji: '🌿', category: 'Vegetables',   qtyRange: [1, 5]  },
    'Ridge Gourd':     { price: 30,  unit: 'kg',    emoji: '🌿', category: 'Vegetables',   qtyRange: [2, 6]  },
    'Beans':           { price: 50,  unit: 'kg',    emoji: '🫘', category: 'Vegetables',   qtyRange: [2, 8]  },
    'Cluster Beans':   { price: 45,  unit: 'kg',    emoji: '🫘', category: 'Vegetables',   qtyRange: [1, 5]  },
    'Green Chilli':    { price: 60,  unit: 'kg',    emoji: '🌶️', category: 'Spices',      qtyRange: [1, 5]  },
    'Ginger':          { price: 80,  unit: 'kg',    emoji: '🫚', category: 'Spices',      qtyRange: [1, 3]  },
    'Garlic':          { price: 120, unit: 'kg',    emoji: '🧄', category: 'Spices',      qtyRange: [1, 3]  },
    'Turmeric':        { price: 100, unit: 'kg',    emoji: '🌿', category: 'Spices',      qtyRange: [1, 3]  },
    'Coconut':         { price: 20,  unit: 'piece', emoji: '🥥', category: 'Fruits',      qtyRange: [5, 15] },
    'Banana':          { price: 5,   unit: 'piece', emoji: '🍌', category: 'Fruits',      qtyRange: [10, 30] },
    'Plantain':        { price: 6,   unit: 'piece', emoji: '🍌', category: 'Fruits',      qtyRange: [10, 30] },
    'Mango':           { price: 30,  unit: 'piece', emoji: '🥭', category: 'Fruits',      qtyRange: [5, 20] },
    'Papaya':          { price: 15,  unit: 'piece', emoji: '🍑', category: 'Fruits',      qtyRange: [2, 8]  },
    'Guava':           { price: 10,  unit: 'piece', emoji: '🍐', category: 'Fruits',      qtyRange: [5, 15] },
    'Lemon':           { price: 5,   unit: 'piece', emoji: '🍋', category: 'Fruits',      qtyRange: [10, 30] },
    'Pomegranate':     { price: 25,  unit: 'piece', emoji: '🍎', category: 'Fruits',      qtyRange: [3, 10] },
    'Sapota':          { price: 10,  unit: 'piece', emoji: '🟤', category: 'Fruits',      qtyRange: [5, 15] },
    'Jackfruit':       { price: 50,  unit: 'piece', emoji: '🟡', category: 'Fruits',      qtyRange: [2, 5]  },
    'Curry Leaves':    { price: 5,   unit: 'bunch', emoji: '🌿', category: 'Leafy Greens', qtyRange: [10, 30] },
    'Drumstick Leaves':{ price: 8,   unit: 'bunch', emoji: '🌿', category: 'Leafy Greens', qtyRange: [5, 15] },
    'Aloe Vera':       { price: 20,  unit: 'piece', emoji: '🌵', category: 'Herbs',       qtyRange: [3, 10] },
    'Groundnut':       { price: 80,  unit: 'kg',    emoji: '🥜', category: 'Pulses',      qtyRange: [2, 10] },
    'Maize':           { price: 15,  unit: 'piece', emoji: '🌽', category: 'Grains',      qtyRange: [5, 20] },
    'Sugarcane':       { price: 20,  unit: 'piece', emoji: '🌿', category: 'Grains',      qtyRange: [3, 10] },
    'Sweet Potato':    { price: 30,  unit: 'kg',    emoji: '🍠', category: 'Vegetables',  qtyRange: [2, 8]  },
    'Jasmine':         { price: 30,  unit: 'bunch', emoji: '🌸', category: 'Flowers',     qtyRange: [5, 20] },
    'Marigold':        { price: 20,  unit: 'bunch', emoji: '🌼', category: 'Flowers',     qtyRange: [5, 20] },
  },

  // ── JSON Schema Builders ──────────────────────────────────────

  /**
   * Builds the REQUEST JSON that is dispatched to farmer agents.
   */
  buildRequestPayload(order) {
    return {
      schema:       'FarmConnect:AgentRequest:v1',
      requestId:    order.id,
      timestamp:    order.createdAt,
      sentAt:       new Date(order.createdAt).toISOString(),
      product:      order.productName,
      quantity:     order.requestedQty,
      unit:         order.unit || 'piece',
      consumer: {
        id:       order.consumerId,
        name:     order.consumerName,
        location: order.consumerLocation
      },
      broadcast: {
        radiusKm: 3,
        toAll:    true,
        note:     'Request sent to all registered farmers within 3 km regardless of inventory'
      }
    };
  },

  /**
   * Builds the RESPONSE JSON that a farmer agent sends back.
   */
  buildResponsePayload(farmer, product, distance, requestId) {
    return {
      schema:      'FarmConnect:AgentResponse:v1',
      requestId,
      respondedAt: Date.now(),
      sentAt:      new Date().toISOString(),
      farmer: {
        id:       farmer.id,
        name:     farmer.name,
        phone:    farmer.phone,
        location: farmer.location,
        rating:   farmer.rating,
        farmType: farmer.farmType,
        source:   farmer.source  // 'json' | 'manual'
      },
      offer: {
        productId:  product.id,
        name:       product.name,
        price:      product.price,
        quantity:   product.quantity,
        unit:       product.unit,
        emoji:      product.emoji,
        category:   product.category,
        autoListed: product.agentGenerated === true
      },
      distance: Math.round(distance * 1000) / 1000,
      status:   'available'
    };
  },

  // ── Core Dispatch ─────────────────────────────────────────────

  /**
   * Dispatches a consumer request to all matching farmer agents within 3 km.
   *
   * INPUT:  order object (JSON) → farmer agents
   * OUTPUT: farmer response objects (JSON) → added to product store
   *
   * @param {Object} order  The saved order from Store.addOrder()
   * @returns {{ responses: Array, requestPayload: Object }}
   */
  dispatchRequest(order) {
    const consumerLoc = order.consumerLocation;
    if (!consumerLoc) return { responses: [], requestPayload: null };

    // Build and log the outgoing request JSON
    const requestPayload = this.buildRequestPayload(order);
    console.group('📡 FarmConnect Agent Broadcast');
    console.log('%c→ REQUEST JSON (consumer → agents)', 'color:#2D7A4F;font-weight:bold');
    console.log(JSON.stringify(requestPayload, null, 2));

    const allFarmers = Store.getAllFarmers();
    const responses  = [];
    const autoListed = [];

    for (const farmer of allFarmers) {
      if (!farmer.location || !farmer.location.lat) continue;
      const distance = Geo.haversineDistance(consumerLoc, farmer.location);
      if (distance > 3) continue;

      // Check if farmer's specialties include the requested product
      const matchedSpecialty = this._matchSpecialty(farmer.specialties || [], order.productName);
      if (!matchedSpecialty) continue;

      // Check if farmer already has this product listed
      let product = Store.getProductsByFarmer(farmer.id).find(p =>
        p.name.toLowerCase() === order.productName.toLowerCase()
      );

      if (!product) {
        // ── Agent Auto-Creates Product Listing ──────────────────
        const guide = this._getGuide(order.productName);
        const qty   = Math.floor(
          Math.random() * (guide.qtyRange[1] - guide.qtyRange[0] + 1)
        ) + guide.qtyRange[0];

        product = Store.addProduct({
          farmerId:       farmer.id,
          farmerName:     farmer.name,
          name:           order.productName,
          category:       guide.category,
          quantity:       qty,
          unit:           guide.unit,
          price:          guide.price,
          reservedQty:    0,
          location:       farmer.location,
          emoji:          guide.emoji,
          agentGenerated: true,   // ← marks as auto-created by agent
          requestId:      order.id
        });

        autoListed.push(farmer.name);
      }

      const responsePayload = this.buildResponsePayload(farmer, product, distance, order.id);
      console.log(`%c← RESPONSE from ${farmer.name} (${Geo.formatDistance(distance)})`,
                  'color:#F4A535;font-weight:bold');
      console.log(JSON.stringify(responsePayload, null, 2));
      responses.push({ farmer, product, distance, responsePayload });
    }

    if (responses.length === 0) {
      console.log('%c⚠ No agents responded (no specialty match within 3km)', 'color:#E53E3E');
    } else {
      console.log(
        `%c✅ ${responses.length} agent(s) responded. ${autoListed.length} auto-listed product(s).`,
        'color:#2D7A4F;font-weight:bold'
      );
    }
    console.groupEnd();

    // Persist response summary to order
    Store.updateOrder(order.id, {
      agentResponses: responses.length,
      autoListedBy:   autoListed
    });

    return { responses, requestPayload, autoListed };
  },

  // ── Helpers ───────────────────────────────────────────────────

  /**
   * Check if any of a farmer's specialties fuzzy-match the product name.
   * e.g. "Drumstick" matches "Drumstick Leaves" or "Moringa"
   */
  _matchSpecialty(specialties, productName) {
    const pLower = productName.toLowerCase();
    return specialties.find(s => {
      const sLower = s.toLowerCase();
      return sLower.includes(pLower) ||
             pLower.includes(sLower) ||
             pLower.split(' ')[0] === sLower.split(' ')[0]; // first word match
    }) || null;
  },

  /**
   * Look up the price guide for a product name (fuzzy match).
   * Returns a default if no match found.
   */
  _getGuide(productName) {
    const pLower = productName.toLowerCase();
    for (const [key, guide] of Object.entries(this.PRODUCE_GUIDE)) {
      if (key.toLowerCase() === pLower ||
          pLower.includes(key.toLowerCase()) ||
          key.toLowerCase().includes(pLower)) {
        return guide;
      }
    }
    // Generic fallback
    return { price: 20, unit: 'piece', emoji: '🌿', category: 'Vegetables', qtyRange: [5, 15] };
  },

  /**
   * Purge all agent-auto-generated product listings (for a specific requestId or all).
   * Useful for cleanup when an order is cancelled.
   */
  purgeAutoListings(requestId = null) {
    const products = Store.getProducts();
    const toKeep = products.filter(p => {
      if (!p.agentGenerated) return true;
      if (requestId) return p.requestId !== requestId;
      return false;
    });
    if (toKeep.length < products.length) {
      Store._saveProducts(toKeep);
    }
  },

  // ══════════════════════════════════════════════════════════════
  //  FARMER → CONSUMER PUSH  (reverse A2A flow)
  // ══════════════════════════════════════════════════════════════

  /**
   * Builds the PUSH JSON sent FROM a farmer agent TO consumer agents.
   * Schema: FarmConnect:AgentPush:v1
   */
  buildPushPayload(farmer, product) {
    return {
      schema:    'FarmConnect:AgentPush:v1',
      pushId:    Store.uuid(),
      timestamp: Date.now(),
      sentAt:    new Date().toISOString(),
      farmer: {
        id:       farmer.id,
        name:     farmer.name,
        phone:    farmer.phone,
        location: farmer.location,
        rating:   farmer.rating,
        farmType: farmer.farmType,
        source:   farmer.source      // 'json' | 'manual'
      },
      product: {
        id:       product.id,
        name:     product.name,
        price:    product.price,
        quantity: product.quantity,
        unit:     product.unit,
        emoji:    product.emoji,
        category: product.category
      },
      broadcast: {
        radiusKm: 3,
        toAll:    true,
        note:     'Farmer is proactively pushing availability to all consumers within 3 km'
      }
    };
  },

  /**
   * Builds the RECEIVED JSON that each consumer agent acknowledges.
   * Schema: FarmConnect:AgentPushReceived:v1
   */
  buildPushReceivedPayload(consumer, farmer, product, distance, pushId) {
    return {
      schema:      'FarmConnect:AgentPushReceived:v1',
      pushId,
      receivedAt:  Date.now(),
      sentAt:      new Date().toISOString(),
      consumer: {
        id:       consumer.id,
        name:     consumer.name,
        location: consumer.location
      },
      farmer: {
        id:   farmer.id,
        name: farmer.name
      },
      product: {
        name:  product.name,
        price: product.price,
        unit:  product.unit
      },
      distance: Math.round(distance * 1000) / 1000,
      status:   'received'
    };
  },

  /**
   * Farmer pushes their availability to all consumers within 3 km.
   *
   * INPUT:  farmer + product (JSON) → consumer agents
   * OUTPUT: consumer receive-acknowledgement JSONs → notifications + product visible on consumer home
   *
   * @param {Object} farmer   The current farmer user object
   * @param {Object} product  Product data { name, price, qty, unit, emoji, category }
   * @returns {{ pushPayload, received: Array }}
   */
  pushAvailability(farmer, product) {
    if (!farmer.location || !farmer.location.lat) {
      return { pushPayload: null, received: [] };
    }

    // ── Ensure product is in store ─────────────────────────────
    let storedProduct = Store.getProductsByFarmer(farmer.id)
      .find(p => p.name.toLowerCase() === product.name.toLowerCase());

    if (!storedProduct) {
      storedProduct = Store.addProduct({
        farmerId:       farmer.id,
        farmerName:     farmer.name,
        name:           product.name,
        category:       product.category || this._getGuide(product.name).category,
        quantity:       product.quantity,
        unit:           product.unit,
        price:          product.price,
        reservedQty:    0,
        location:       farmer.location,
        emoji:          product.emoji || this._getGuide(product.name).emoji,
        farmerPushed:   true,   // ← marks as farmer-initiated push
        pushedAt:       Date.now()
      });
    } else {
      // Update existing listing with new qty/price
      storedProduct = Store.updateProduct(storedProduct.id, {
        quantity:     product.quantity,
        price:        product.price,
        farmerPushed: true,
        pushedAt:     Date.now()
      });
    }

    // ── Build & log PUSH JSON ──────────────────────────────────
    const pushPayload = this.buildPushPayload(farmer, storedProduct);
    console.group('🚀 FarmConnect Farmer Push');
    console.log('%c→ PUSH JSON (farmer → consumer agents)', 'color:#7C3AED;font-weight:bold');
    console.log(JSON.stringify(pushPayload, null, 2));

    // ── Find all consumers within 3 km ─────────────────────────
    const allUsers   = Store.getUsers();
    const consumers  = allUsers.filter(u => u.role === 'consumer' && u.location && u.location.lat);
    const received   = [];

    for (const consumer of consumers) {
      const distance = Geo.haversineDistance(farmer.location, consumer.location);
      if (distance > 3) continue;

      // Notify this consumer
      Store.addNotification({
        userId:  consumer.id,
        message: `📢 ${farmer.name} (${Geo.formatDistance(distance)} away) just listed ${storedProduct.name} — ₹${storedProduct.price}/${storedProduct.unit}. Tap to view.`,
        type:    'push',
        orderId: null,
        extra:   { productId: storedProduct.id, farmerId: farmer.id }
      });

      const receivePayload = this.buildPushReceivedPayload(
        consumer, farmer, storedProduct, distance, pushPayload.pushId
      );
      console.log(
        `%c← RECEIVED by ${consumer.name} (${Geo.formatDistance(distance)})`,
        'color:#2563EB;font-weight:bold'
      );
      console.log(JSON.stringify(receivePayload, null, 2));
      received.push({ consumer, distance, receivePayload });
    }

    console.log(
      `%c✅ Push delivered to ${received.length} consumer(s) within 3 km`,
      'color:#7C3AED;font-weight:bold'
    );
    console.groupEnd();

    return { pushPayload, received, product: storedProduct };
  }
};

