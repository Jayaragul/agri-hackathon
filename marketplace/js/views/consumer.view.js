/**
 * ConsumerView — Blinkit-style consumer home + broadcast request fallback
 *
 * FLOW:
 *  - In-stock products: tap → product sheet with qty selector → Add to Cart
 *  - Cart → Place Order → creates orders, broadcasts to farmers via Agent
 *  - Unlisted product: "Can't find it?" request box → broadcast to all nearby farmers
 */
const ConsumerView = {

  _activeCategory: 'All',
  _searchQuery: '',
  _pendingRequest: null,   // { productName, quantity, unit, maxPrice }
  _broadcastResult: null,  // { withInventory, withoutInventory, all }
  _selectedMatch: null,
  _cart: [],               // [{ product, qty }]  ← Blinkit-style cart
  _sheetProductId: null,   // currently open product sheet

  // ── Home ──────────────────────────────────────────────────────

  showHome() {
    Nav.push({ view: 'consumer-home' });
    const user = Store.getCurrentUser();
    if (!user) return;

    Navbar.render('consumer', 'home');
    NotificationSystem.updateBadge();

    const content = document.getElementById('app-content');

    const products = Store.getProducts();
    const categories = ['All', ...new Set(products.map(p => p.category))];

    // Count farmers within 3km for the hero display
    const consumerLoc = user.location || { lat: 12.9716, lng: 77.5946 };
    const nearbyFarmers = Store.getAllFarmers().filter(f => {
      if (!f.location || !f.location.lat) return false;
      return Geo.haversineDistance(consumerLoc, f.location) <= 3;
    });

    content.innerHTML = `
      <!-- Hero Banner with inline CTA -->
      <div class="hero-banner">
        <div class="hero-greeting">Hello,</div>
        <div class="hero-name">${user.name} 👋</div>
        <div class="hero-location">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
          ${user.location ? user.location.label : 'Set your location'}
        </div>
        <div class="hero-farmers-pill">🌾 ${nearbyFarmers.length} farmers within 3 km</div>
        <button class="hero-cta-btn" onclick="ConsumerView.showRequestForm()" id="hero-request-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Request a Product
        </button>
      </div>

      <!-- Search Bar -->
      <div class="search-bar-wrap" style="margin-top:-30px;position:relative;z-index:5;">
        <div class="search-bar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input type="text" id="product-search" placeholder="Search produce..." oninput="ConsumerView._onSearch(this.value)">
        </div>
      </div>

      <!-- Category Chips -->
      <div class="category-scroll" id="category-chips">
        ${categories.map(cat => `
          <div class="category-chip ${cat === this._activeCategory ? 'active' : ''}"
               onclick="ConsumerView._filterCategory('${cat}')">${cat}</div>
        `).join('')}
      </div>

      <!-- Browse Produce (optional inventory listed by farmers) -->
      <div class="section-header">
        <div class="section-title">Browse Produce 🌱</div>
        <div class="text-sm text-muted">Within 3 km</div>
      </div>
      <div class="products-grid" id="products-grid">
        ${this._renderProductCards(products, user)}
      </div>

      <!-- Farmers Near You -->
      <div class="section-header" style="margin-top:8px;">
        <div class="section-title">Farmers Near You 🌾</div>
        <div class="text-sm text-muted">${nearbyFarmers.length} within 3 km</div>
      </div>
      <div class="farmers-nearby-grid" id="farmers-nearby-grid">
        ${this._renderNearbyFarmers(nearbyFarmers, consumerLoc)}
      </div>

      <!-- ── Request Box (unlisted products) ── -->
      <div class="request-box">
        <div class="request-box-icon">🔍</div>
        <div class="request-box-title">Can't find what you need?</div>
        <div class="request-box-sub">Tell us — we'll broadcast to all <strong>${nearbyFarmers.length}</strong> nearby farmers instantly.</div>
        <div class="request-box-row">
          <div style="position:relative;flex:1;">
            <input class="form-control request-box-input" type="text" id="quick-request-input"
                   placeholder="e.g. Drumstick, Raw Mango, Curry Leaves..."
                   oninput="ConsumerView._showRequestBoxSuggestions(this.value)"
                   autocomplete="off">
            <div id="rbox-suggestions" class="suggestions-list hidden"></div>
          </div>
          <button class="btn btn-primary request-box-btn" onclick="ConsumerView._quickBroadcast()">Broadcast →</button>
        </div>
      </div>

      <!-- Product Quick-Add Sheet -->
      <div id="product-sheet-overlay" class="sheet-overlay hidden" onclick="ConsumerView._closeSheet()"></div>
      <div id="product-sheet" class="product-sheet hidden"></div>
    `;
  },

  _renderProductCards(allProducts, user) {
    const consumerLoc = user.location || { lat: 12.9716, lng: 77.5946 };

    let filtered = allProducts.filter(p => {
      const available = p.quantity - (p.reservedQty || 0);
      if (available <= 0) return false;
      if (this._activeCategory !== 'All' && p.category !== this._activeCategory) return false;
      if (this._searchQuery && !p.name.toLowerCase().includes(this._searchQuery.toLowerCase())) return false;
      return true;
    });

    filtered = filtered.map(p => {
      const loc = (p.location && p.location.lat) ? p.location : consumerLoc;
      return { ...p, distance: Geo.haversineDistance(consumerLoc, loc) };
    }).filter(p => p.distance <= 3).sort((a, b) => a.distance - b.distance);

    if (filtered.length === 0) {
      return `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-state-icon">🌾</div>
          <div class="empty-state-title">No listed produce found</div>
          <div class="empty-state-msg">
            ${this._searchQuery
              ? `No results for "${this._searchQuery}". Use "Request a Product" and we'll broadcast to all nearby farmers!`
              : 'No produce listed right now — but you can still request anything via the button above.'}
          </div>
          <button class="btn btn-primary" style="margin-top:16px" onclick="ConsumerView.showRequestForm('${this._searchQuery}')">
            📡 Request "${this._searchQuery || 'a product'}"
          </button>
        </div>
      `;
    }

    return filtered.map((p, i) => {
      const inCart = this._cartQty(p.id);
      return `
        <div class="product-card ${p.agentGenerated ? 'agent-listed' : ''} ${p.farmerPushed ? 'farmer-pushed' : ''}"
             onclick="ConsumerView._showProductSheet('${p.id}')"
             style="animation-delay:${i * 0.05}s; cursor:pointer;">
          <span class="product-distance-badge">${Geo.formatDistance(p.distance)}</span>
          ${p.agentGenerated ? '<span class="agent-badge">🤖 Agent listed</span>' : ''}
          ${p.farmerPushed && !p.agentGenerated ? '<span class="agent-badge" style="background:#FDE9FF;color:#7C3AED;">🚀 Farmer pushed</span>' : ''}
          <span class="product-emoji">${p.emoji || '🌿'}</span>
          <div class="product-name">${p.name}</div>
          <div class="product-farmer">${p.farmerName}</div>
          <div class="product-card-footer">
            <div>
              <span class="product-price">₹${p.price}</span>
              <span class="product-unit">/${p.unit}</span>
            </div>
            ${inCart > 0
              ? `<div class="cart-qty-control">
                   <button class="qty-btn-sm" onclick="event.stopPropagation();ConsumerView._cardQtyChange('${p.id}',-1)">−</button>
                   <span class="qty-sm">${inCart}</span>
                   <button class="qty-btn-sm" onclick="event.stopPropagation();ConsumerView._cardQtyChange('${p.id}',1)">+</button>
                 </div>`
              : `<button class="product-add-btn"
                         onclick="event.stopPropagation();ConsumerView._cardAdd('${p.id}')"
                         title="Add to cart">+</button>`
            }
          </div>
        </div>
      `;
    }).join('');
  },


  // ── Cart ──────────────────────────────────────────────────────

  _cartQty(productId) {
    const item = this._cart.find(i => i.product.id === productId);
    return item ? item.qty : 0;
  },

  _addToCart(product, qty) {
    const idx = this._cart.findIndex(i => i.product.id === product.id);
    if (idx >= 0) {
      this._cart[idx].qty = Math.max(0, this._cart[idx].qty + qty);
      if (this._cart[idx].qty === 0) this._cart.splice(idx, 1);
    } else if (qty > 0) {
      this._cart.push({ product, qty });
    }
    this._updateCartBadge();
  },

  _setCartQty(productId, qty) {
    const idx = this._cart.findIndex(i => i.product.id === productId);
    if (qty <= 0) { if (idx >= 0) this._cart.splice(idx, 1); }
    else if (idx >= 0) { this._cart[idx].qty = qty; }
    else { const p = Store.getProductById(productId); if (p) this._cart.push({ product: p, qty }); }
    this._updateCartBadge();
  },

  _updateCartBadge() {
    const total = this._cart.reduce((s, i) => s + i.qty, 0);
    const badge = document.getElementById('cart-badge');
    const btn   = document.getElementById('cart-btn');
    if (!badge || !btn) return;
    if (total > 0) {
      badge.textContent = total;
      badge.classList.remove('hidden');
      btn.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  },

  // + button on card: add 1 to cart and refresh grid
  _cardAdd(productId) {
    const p = Store.getProductById(productId);
    if (!p) return;
    this._addToCart(p, 1);
    // Refresh grid inline to show qty control
    const user = Store.getCurrentUser();
    const grid = document.getElementById('products-grid');
    if (grid) grid.innerHTML = this._renderProductCards(Store.getProducts(), user);
    Toast.success(`${p.emoji || '🌿'} ${p.name} added to cart!`);
  },

  // − / + on the card's inline qty control
  _cardQtyChange(productId, delta) {
    const p = Store.getProductById(productId);
    if (!p) return;
    const current = this._cartQty(productId);
    const avail   = p.quantity - (p.reservedQty || 0);
    const newQty  = Math.max(0, Math.min(current + delta, avail));
    this._setCartQty(productId, newQty);
    // Refresh grid
    const user = Store.getCurrentUser();
    const grid = document.getElementById('products-grid');
    if (grid) grid.innerHTML = this._renderProductCards(Store.getProducts(), user);
  },

  // Request box suggestions (unlisted products)
  _showRequestBoxSuggestions(query) {
    const box = document.getElementById('rbox-suggestions');
    if (!box || !query) { if (box) box.classList.add('hidden'); return; }
    const allNames = [
      ...Store.getProducts().map(p => p.name),
      ...Store.getAllFarmers().flatMap(f => f.specialties || [])
    ].filter((v, i, a) => a.indexOf(v) === i);
    const matched = allNames.filter(s => s.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
    if (!matched.length) { box.classList.add('hidden'); return; }
    box.innerHTML = matched.map(s =>
      `<div class="suggestion-item" onclick="document.getElementById('quick-request-input').value='${s}';document.getElementById('rbox-suggestions').classList.add('hidden');">🌿 ${s}</div>`
    ).join('');
    box.classList.remove('hidden');
  },

  // Broadcast from the request box
  _quickBroadcast() {
    const val = document.getElementById('quick-request-input')?.value.trim();
    if (!val) { Toast.error('Please enter a product name.'); return; }
    this.showRequestForm(val, 'piece', '', '');
  },



  // ── Product Sheet (Blinkit quick-add) ─────────────────────────

  _showProductSheet(productId) {
    const p   = Store.getProductById(productId);
    if (!p) return;
    const user = Store.getCurrentUser();
    const consumerLoc = user.location || { lat: 12.9716, lng: 77.5946 };
    const distance = Geo.haversineDistance(consumerLoc, p.location || consumerLoc);
    const available = p.quantity - (p.reservedQty || 0);
    const currentQty = this._cartQty(productId) || 1;
    this._sheetProductId = productId;

    const sheet   = document.getElementById('product-sheet');
    const overlay = document.getElementById('product-sheet-overlay');
    if (!sheet || !overlay) return;

    sheet.innerHTML = `
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <div>
          <span class="sheet-emoji">${p.emoji || '🌿'}</span>
          <div class="sheet-product-name">${p.name}</div>
          <div class="sheet-farmer">🌾 ${p.farmerName} · ${Geo.formatDistance(distance)} away</div>
          ${p.agentGenerated ? '<span class="agent-badge" style="margin:6px 0;display:inline-block;">🤖 Agent listed</span>' : ''}
          ${p.farmerPushed && !p.agentGenerated ? '<span class="agent-badge" style="background:#FDE9FF;color:#7C3AED;margin:6px 0;display:inline-block;">🚀 Farmer pushed</span>' : ''}
        </div>
        <button class="sheet-close" onclick="ConsumerView._closeSheet()">✕</button>
      </div>

      <div class="sheet-price-row">
        <span class="sheet-price">₹${p.price}</span>
        <span class="sheet-unit">per ${p.unit}</span>
        <span class="available-badge" style="margin-left:auto;">${available} left</span>
      </div>

      <div class="sheet-qty-row">
        <button class="qty-btn" onclick="ConsumerView._sheetQtyChange(-1)">−</button>
        <span class="qty-display" id="sheet-qty">${currentQty}</span>
        <button class="qty-btn" onclick="ConsumerView._sheetQtyChange(1)">+</button>
      </div>

      <button class="btn btn-primary btn-full sheet-add-btn" id="sheet-add-btn"
              onclick="ConsumerView._sheetAddToCart()">
        Add to Cart · ₹<span id="sheet-total">${p.price * currentQty}</span>
      </button>
    `;

    overlay.classList.remove('hidden');
    sheet.classList.remove('hidden');
    requestAnimationFrame(() => sheet.classList.add('open'));
  },

  _sheetQtyChange(delta) {
    const pid = this._sheetProductId;
    const p   = Store.getProductById(pid);
    if (!p) return;
    const available = p.quantity - (p.reservedQty || 0);
    const qEl = document.getElementById('sheet-qty');
    let qty = parseInt(qEl.textContent) + delta;
    qty = Math.max(1, Math.min(qty, available));
    qEl.textContent = qty;
    const total = document.getElementById('sheet-total');
    if (total) total.textContent = p.price * qty;
  },

  _sheetAddToCart() {
    const pid = this._sheetProductId;
    const p   = Store.getProductById(pid);
    const qty = parseInt(document.getElementById('sheet-qty').textContent);
    if (!p || !qty) return;
    const existing = this._cart.findIndex(i => i.product.id === pid);
    if (existing >= 0) this._cart[existing].qty = qty;
    else this._cart.push({ product: p, qty });
    this._updateCartBadge();
    this._closeSheet();
    Toast.success(`${p.emoji || '🌿'} ${p.name} ×${qty} added to cart!`);
  },

  _closeSheet() {
    const sheet   = document.getElementById('product-sheet');
    const overlay = document.getElementById('product-sheet-overlay');
    if (!sheet) return;
    sheet.classList.remove('open');
    setTimeout(() => {
      sheet.classList.add('hidden');
      if (overlay) overlay.classList.add('hidden');
    }, 280);
  },

  // ── Cart Page ─────────────────────────────────────────────────

  _showCart() {
    if (this._cart.length === 0) {
      Toast.info('Your cart is empty. Browse produce and add items!');
      return;
    }
    const content = document.getElementById('app-content');
    const total = this._cart.reduce((s, i) => s + i.product.price * i.qty, 0);

    content.innerHTML = `
      <div class="add-product-page">
        <button class="back-btn" onclick="ConsumerView.showHome()">← Continue Shopping</button>

        <div class="form-page-header">
          <div class="form-page-title">🛒 Your Cart</div>
          <div class="form-page-subtitle">${this._cart.length} item${this._cart.length !== 1 ? 's' : ''} from nearby farmers</div>
        </div>

        <div class="cart-items">
          ${this._cart.map(item => `
            <div class="cart-item" id="cart-item-${item.product.id}">
              <span class="cart-item-emoji">${item.product.emoji || '🌿'}</span>
              <div class="cart-item-info">
                <div class="cart-item-name">${item.product.name}</div>
                <div class="cart-item-farmer">${item.product.farmerName}</div>
                <div class="cart-item-price">₹${item.product.price}/${item.product.unit}</div>
              </div>
              <div class="cart-item-qty">
                <button class="qty-btn" onclick="ConsumerView._cartQtyChange('${item.product.id}', -1)">−</button>
                <span class="qty-display" id="cqty-${item.product.id}">${item.qty}</span>
                <button class="qty-btn" onclick="ConsumerView._cartQtyChange('${item.product.id}', 1)">+</button>
              </div>
              <div class="cart-item-subtotal">₹${item.product.price * item.qty}</div>
            </div>
          `).join('')}
        </div>

        <div class="cart-total-row">
          <span>Total</span>
          <span class="cart-total-value" id="cart-grand-total">₹${total}</span>
        </div>

        <div style="padding:12px 16px;background:var(--primary-light);border-radius:var(--radius-md);margin-bottom:20px;font-size:var(--text-sm);color:var(--primary);">
          📍 All items will be picked up directly from the farmers. <strong>Pay at pickup (Cash).</strong>
        </div>

        <button class="btn btn-primary btn-full" onclick="ConsumerView._placeOrder()" id="place-order-btn">
          📦 Place Order · ₹${total}
        </button>
      </div>
    `;
  },

  _cartQtyChange(productId, delta) {
    const item = this._cart.find(i => i.product.id === productId);
    if (!item) return;
    const avail = item.product.quantity - (item.product.reservedQty || 0);
    item.qty = Math.max(0, Math.min(item.qty + delta, avail));
    if (item.qty === 0) {
      this._cart = this._cart.filter(i => i.product.id !== productId);
      this._updateCartBadge();
      if (this._cart.length === 0) { this.showHome(); return; }
      this._showCart(); return;
    }
    const qEl  = document.getElementById(`cqty-${productId}`);
    if (qEl) qEl.textContent = item.qty;
    // update subtotal
    const row = document.getElementById(`cart-item-${productId}`);
    if (row) {
      const sub = row.querySelector('.cart-item-subtotal');
      if (sub) sub.textContent = `₹${item.product.price * item.qty}`;
    }
    // update grand total
    const newTotal = this._cart.reduce((s, i) => s + i.product.price * i.qty, 0);
    const totEl = document.getElementById('cart-grand-total');
    if (totEl) totEl.textContent = `₹${newTotal}`;
    const orderBtn = document.getElementById('place-order-btn');
    if (orderBtn) orderBtn.textContent = `📦 Place Order · ₹${newTotal}`;
    this._updateCartBadge();
  },

  _placeOrder() {
    const btn = document.getElementById('place-order-btn');
    if (btn) { btn.textContent = 'Placing Order...'; btn.disabled = true; }
    const user = Store.getCurrentUser();
    const consumerLoc = user.location || { lat: 12.9716, lng: 77.5946 };

    setTimeout(() => {
      const orderIds = [];
      for (const item of this._cart) {
        const broadcastResult = Matching.broadcastRequest(item.product.name, item.qty, consumerLoc);
        const matchedFarmerIds = broadcastResult.all.map(m => m.farmer.id);

        const order = Store.addOrder({
          consumerId:       user.id,
          consumerName:     user.name,
          productName:      item.product.name,
          requestedQty:     item.qty,
          unit:             item.product.unit,
          price:            item.product.price,
          status:           'matched',
          consumerLocation: consumerLoc,
          matchedFarmerIds,
          targetFarmerId:   item.product.farmerId,
          targetFarmerName: item.product.farmerName
        });

        // Agent dispatch — notify all agents
        Agent.dispatchRequest(order);
        NotificationSystem.notifyMatchedFarmers(order, broadcastResult.all);
        if (typeof Bridge !== 'undefined') void Bridge.pushOrder(order);
        orderIds.push(order.id);
      }

      NotificationSystem.updateBadge();
      this._cart = [];  // clear cart
      this._updateCartBadge();

      Toast.success(`✅ ${orderIds.length} order${orderIds.length !== 1 ? 's' : ''} placed! Farmers have been notified.`);
      setTimeout(() => OrdersView.show(), 900);
    }, 800);
  },

  // ── Farmers Near You (rendered on the home grid) ───────────────

  _renderNearbyFarmers(farmers, consumerLoc) {
    if (farmers.length === 0) {
      return `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">🌾</div><div class="empty-state-title">No farmers in range</div></div>`;
    }

    return farmers
      .map(f => ({ ...f, _dist: Geo.haversineDistance(consumerLoc, f.location) }))
      .sort((a, b) => a._dist - b._dist)
      .map((f, i) => {
        const specialties = (f.specialties || []).slice(0, 3).join(', ') || 'Various produce';
        const farmTypeLabel = { terrace: 'Terrace Farm', backyard: 'Backyard Farm', garden: 'Garden', community_plot: 'Community Plot', farm_plot: 'Farm Plot', orchard: 'Orchard', balcony: 'Balcony Farm' }[f.farmType] || 'Farm';
        const stars = '⭐'.repeat(Math.round(f.rating || 4));
        return `
          <div class="farmer-nearby-card" onclick="ConsumerView.showRequestForm('', 'piece')"
               style="animation-delay:${i * 0.04}s" title="Tap to request from this area">
            <div class="farmer-nearby-avatar">${f.emoji || f.name.charAt(0)}</div>
            <div class="farmer-nearby-info">
              <div class="farmer-nearby-name">${f.name}</div>
              <div class="farmer-nearby-type">${farmTypeLabel}</div>
              <div class="farmer-nearby-specialties">🌿 ${specialties}</div>
            </div>
            <div class="farmer-nearby-right">
              <div class="farmer-nearby-dist">${Geo.formatDistance(f._dist)}</div>
              <div class="farmer-nearby-rating">${f.rating || 4.5}★</div>
              ${f.source === 'json' ? '<div class="farmer-source-badge">Verified</div>' : '<div class="farmer-source-badge manual">Registered</div>'}
            </div>
          </div>
        `;
      }).join('');
  },

  _filterCategory(cat) {
    this._activeCategory = cat;
    this.showHome();
  },

  _onSearch(q) {
    this._searchQuery = q;
    const user = Store.getCurrentUser();
    const products = Store.getProducts();
    document.getElementById('products-grid').innerHTML =
      this._renderProductCards(products, user);
  },

  // Quick-request: clicking the whole card → request form prefilled (qty blank, user sets it)
  _quickRequest(productId) {
    const p = Store.getProductById(productId);
    if (!p) return;
    this.showRequestForm(p.name, p.unit, '', '');
  },

  // + button: opens request form with qty=1 prefilled and notifies farmer+agent immediately
  _addProductRequest(productId) {
    const p = Store.getProductById(productId);
    if (!p) return;
    this.showRequestForm(p.name, p.unit, 1, '');
  },

  // ── Request Form ───────────────────────────────────────────────

  showRequestForm(prefillName = '', prefillUnit = 'piece', prefillQty = '', prefillMaxPrice = '') {
    Nav.push({ view: 'request-form', productName: prefillName, unit: prefillUnit, qty: prefillQty, maxPrice: prefillMaxPrice });
    const user = Store.getCurrentUser();
    Navbar.render('consumer', 'home');

    // Suggestions from both listed products AND farmer specialties
    const allProducts = Store.getProducts();
    const listedNames = allProducts.map(p => p.name);
    const specialtyNames = Store.getAllFarmers().flatMap(f => f.specialties || []);
    const suggestions = [...new Set([...listedNames, ...specialtyNames])].sort();
    const units = ['piece', 'kg', 'bunch', 'litre', 'gram'];

    // Count farmers in range for the info bar
    const consumerLoc = user.location || { lat: 12.9716, lng: 77.5946 };
    const farmerCount = Store.getAllFarmers().filter(f =>
      f.location && f.location.lat && Geo.haversineDistance(consumerLoc, f.location) <= 3
    ).length;

    const content = document.getElementById('app-content');
    content.innerHTML = `
      <div class="request-form-page">
        <button class="back-btn" onclick="ConsumerView.showHome()">← Back to Home</button>

        <div class="form-page-header">
          <div class="form-page-title">Request a Product</div>
          <div class="form-page-subtitle">Your request will be broadcast to <strong>${farmerCount} farmers</strong> within 3 km — any who can supply it will accept.</div>
        </div>

        <!-- Broadcast info bar -->
        <div class="broadcast-info-bar">
          <span>📡</span>
          <span>Sent to <strong>all ${farmerCount} nearby farmers</strong> — not just those who listed it</span>
        </div>

        <form id="request-product-form" onsubmit="ConsumerView._handleRequest(event)">

          <!-- Product Name with suggestions -->
          <div class="form-group relative">
            <label for="req-product">What do you need? *</label>
            <input class="form-control" type="text" id="req-product"
                   placeholder="e.g. Drumstick, Tomato, Spinach, Mango..."
                   value="${prefillName}"
                   oninput="ConsumerView._showSuggestions(this.value)"
                   onfocus="ConsumerView._showSuggestions(this.value)"
                   autocomplete="off" required>
            <div id="product-suggestions" class="suggestions-list hidden"></div>
          </div>

          <!-- Quantity & Unit -->
          <div class="form-row">
            <div class="form-group">
              <label for="req-qty">Quantity *</label>
              <input class="form-control" type="number" id="req-qty"
                     placeholder="e.g. 3" min="1" value="${prefillQty}" required>
            </div>
            <div class="form-group">
              <label for="req-unit">Unit *</label>
              <select class="form-control" id="req-unit">
                ${units.map(u => `<option value="${u}" ${u===prefillUnit?'selected':''}>${u}</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- Optional max price -->
          <div class="form-group">
            <label for="req-maxprice">Max Price (₹) — Optional</label>
            <input class="form-control" type="number" id="req-maxprice"
                   placeholder="Leave blank for any price"
                   value="${prefillMaxPrice}" min="0">
          </div>

          <!-- Location -->
          <div class="form-group">
            <label>Your Location</label>
            <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--primary-light);border-radius:var(--radius-md);">
              <span>📍</span>
              <span style="font-size:var(--text-sm);color:var(--primary);font-weight:600;">
                ${user && user.location ? user.location.label : 'Location not set'}
              </span>
            </div>
          </div>

          <button type="submit" class="btn btn-primary btn-full" style="margin-top:8px" id="find-btn">
            📡 Broadcast to Nearby Farmers
          </button>
        </form>
      </div>
    `;

    this._suggestions = suggestions;

    document.addEventListener('click', e => {
      if (!e.target.closest('#req-product') && !e.target.closest('#product-suggestions')) {
        const sug = document.getElementById('product-suggestions');
        if (sug) sug.classList.add('hidden');
      }
    }, { once: false });
  },

  _suggestions: [],

  _showSuggestions(query) {
    const box = document.getElementById('product-suggestions');
    if (!box) return;
    if (!query) { box.classList.add('hidden'); return; }

    const matched = this._suggestions.filter(s =>
      s.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 8);

    if (matched.length === 0) { box.classList.add('hidden'); return; }

    box.innerHTML = matched.map(s => `
      <div class="suggestion-item" onclick="ConsumerView._pickSuggestion('${s}')">
        🌿 ${s}
      </div>
    `).join('');
    box.classList.remove('hidden');
  },

  _pickSuggestion(name) {
    const input = document.getElementById('req-product');
    if (input) input.value = name;
    const box = document.getElementById('product-suggestions');
    if (box) box.classList.add('hidden');
  },

  _handleRequest(e) {
    e.preventDefault();

    const productName = document.getElementById('req-product').value.trim();
    const quantity    = parseInt(document.getElementById('req-qty').value);
    const unit        = document.getElementById('req-unit').value;
    const maxPrice    = parseFloat(document.getElementById('req-maxprice').value) || null;

    if (!productName || !quantity) {
      Toast.error('Please fill all required fields.');
      return;
    }

    const user = Store.getCurrentUser();
    const consumerLoc = user.location || { lat: 12.9716, lng: 77.5946 };

    const btn = document.getElementById('find-btn');
    btn.textContent = 'Broadcasting...';
    btn.disabled = true;

    setTimeout(() => {
      // Fresh broadcast result (never mutate this — used by back button)
      const rawResult = Matching.broadcastRequest(productName, quantity, consumerLoc);

      this._pendingRequest  = { productName, quantity, unit, maxPrice };
      this._broadcastResult = rawResult; // always keep full unfiltered result for back nav

      // Apply max price filter on a COPY for display only
      let displayResult = rawResult;
      if (maxPrice) {
        const filteredWith = rawResult.withInventory.filter(m => m.product && m.product.price <= maxPrice);
        displayResult = {
          withInventory:    filteredWith,
          withoutInventory: rawResult.withoutInventory,
          all:              [...filteredWith, ...rawResult.withoutInventory]
        };
      }

      this.showMatchResults(displayResult);
    }, 800);
  },


  // ── Broadcast Results ──────────────────────────────────────────

  showMatchResults(broadcastResult) {
    Nav.push({ view: 'match-results' });
    const { productName, quantity, unit } = this._pendingRequest;
    const totalFarmers = broadcastResult.all.length;
    const withInventory = broadcastResult.withInventory;
    const withoutInventory = broadcastResult.withoutInventory;

    const content = document.getElementById('app-content');
    content.innerHTML = `
      <div class="request-form-page">
        <button class="back-btn" onclick="ConsumerView._backToRequestForm()">← Edit Request</button>

        <div class="form-page-header">
          <div class="form-page-title">Farmers Near You</div>
          <div class="form-page-subtitle">
            <strong>${totalFarmers} farmer${totalFarmers !== 1 ? 's' : ''}</strong> within 3 km can receive your request for
            <strong>${quantity} ${unit}${quantity>1&&unit==='piece'?'s':''} of ${productName}</strong>
          </div>
        </div>

        ${totalFarmers === 0
          ? this._renderNoMatch(productName)
          : `
            <!-- Tier 1: Has listed inventory -->
            ${withInventory.length > 0 ? `
              <div class="broadcast-tier-header">
                <span class="tier-badge has-stock">✅ Has Stock Listed</span>
                <span class="tier-count">${withInventory.length} farmer${withInventory.length !== 1 ? 's' : ''}</span>
              </div>
              <div class="farmer-matches-grid">
                ${withInventory.map((m, i) => this._renderFarmerMatchCard(m, i, true)).join('')}
              </div>
            ` : ''}

            <!-- Tier 2: All other nearby farmers -->
            ${withoutInventory.length > 0 ? `
              <div class="broadcast-tier-header" style="margin-top:${withInventory.length > 0 ? '20px' : '0'}">
                <span class="tier-badge can-supply">📡 Can Supply (No Listing)</span>
                <span class="tier-count">${withoutInventory.length} farmer${withoutInventory.length !== 1 ? 's' : ''}</span>
              </div>
              <div class="farmer-matches-grid">
                ${withoutInventory.map((m, i) => this._renderFarmerMatchCard(m, i, false)).join('')}
              </div>
            ` : ''}

            <div style="padding-top:16px">
              <p style="font-size:var(--text-xs);color:var(--text-muted);text-align:center;line-height:1.6;">
                📡 Your request will be broadcast to all ${totalFarmers} farmers above.<br>
                First farmer to accept gets the order. Choose one to send a direct request.
              </p>
            </div>
          `
        }
      </div>
    `;
  },

  _renderFarmerMatchCard(match, index, hasInventory) {
    const { farmer, distance, formattedDistance, product } = match;
    const farmerId  = farmer.id;
    const productId = product ? product.id : '';

    const specialties = (farmer.specialties || []).slice(0, 2).join(', ') || 'Various produce';

    return `
      <div class="farmer-match-card ${hasInventory ? '' : 'no-listing'}"
           style="animation-delay:${index*0.06}s"
           onclick="ConsumerView._selectAndSend('${productId}', '${farmerId}', ${hasInventory})">
        <div class="farmer-match-header">
          <div class="farmer-avatar">${farmer.emoji || farmer.name.charAt(0)}</div>
          <div style="flex:1;min-width:0">
            <div class="farmer-match-name">${farmer.name}</div>
            <div class="farmer-match-loc">📍 ${farmer.location ? farmer.location.label : 'Nearby'}</div>
            ${!hasInventory ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">🌿 ${specialties}</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            ${hasInventory && product
              ? `<div style="font-size:var(--text-lg);font-weight:800;color:var(--primary)">₹${product.price}</div>
                 <div style="font-size:var(--text-xs);color:var(--text-muted)">per ${product.unit}</div>`
              : `<div style="font-size:var(--text-xs);color:var(--text-muted);font-style:italic">Price TBD</div>`
            }
          </div>
        </div>

        <div class="farmer-match-meta">
          <span class="meta-chip amber">📍 ${formattedDistance} away</span>
          ${hasInventory && product
            ? `<span class="meta-chip green">✅ ${product.quantity - (product.reservedQty||0)} in stock</span>
               <span class="meta-chip">${product.category}</span>`
            : `<span class="meta-chip">📡 Will receive broadcast</span>`
          }
          ${farmer.rating ? `<span class="meta-chip">⭐ ${farmer.rating}</span>` : ''}
        </div>

        <div style="margin-top:12px;display:flex;justify-content:flex-end;">
          <button class="btn ${hasInventory ? 'btn-primary' : 'btn-secondary'} btn-sm"
                  onclick="event.stopPropagation();ConsumerView._selectAndSend('${productId}','${farmerId}',${hasInventory})">
            ${hasInventory ? 'Send Request →' : 'Request Directly →'}
          </button>
        </div>
      </div>
    `;
  },

  _renderNoMatch(productName) {
    return `
      <div class="no-match-card">
        <div class="no-match-icon">😔</div>
        <div class="no-match-title">No farmers within 3 km</div>
        <div class="no-match-msg">
          No registered farmers are within 3 km of your location right now.
          Try expanding your area or check back later.
        </div>
      </div>
      <div style="margin-top:20px;">
        <button class="btn btn-secondary btn-full" onclick="ConsumerView.showRequestForm('${productName}')">
          ← Edit Request
        </button>
      </div>
    `;
  },

  // ── Confirmation ───────────────────────────────────────────────

  _selectAndSend(productId, farmerId, hasInventory) {
    const user    = Store.getCurrentUser();
    const farmer  = Store.getUserById(farmerId);
    const product = productId ? Store.getProductById(productId) : null;
    if (!farmer) return;

    const consumerLoc = user.location || { lat: 12.9716, lng: 77.5946 };
    const distance    = Geo.haversineDistance(consumerLoc, farmer.location);

    this._selectedMatch = { product, farmer, distance, hasInventory };
    this.showOrderConfirmation();
  },

  showOrderConfirmation() {
    Nav.push({ view: 'order-confirm' });
    const { product, farmer, distance, hasInventory } = this._selectedMatch;
    const { quantity, unit, productName } = this._pendingRequest;

    const content = document.getElementById('app-content');
    content.innerHTML = `
      <div class="confirmation-page">
        <button class="back-btn" onclick="ConsumerView._backToMatches()">← Choose different farmer</button>

        <div class="form-page-title" style="margin-bottom:20px">Confirm Request</div>

        <!-- Farmer card -->
        <div class="confirm-farmer-card">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
            <div class="farmer-avatar" style="width:52px;height:52px;font-size:22px;background:rgba(255,255,255,0.2)">
              ${farmer.emoji || farmer.name.charAt(0)}
            </div>
            <div>
              <div class="confirm-farmer-name">${farmer.name}</div>
              <div class="confirm-farmer-loc">📍 ${Geo.formatDistance(distance)} away · ${farmer.location ? farmer.location.label : 'Nearby'}</div>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${hasInventory
              ? '<span class="meta-chip" style="background:rgba(255,255,255,0.2);color:white;">✅ Has stock listed</span>'
              : '<span class="meta-chip" style="background:rgba(255,255,255,0.2);color:white;">📡 Broadcast request</span>'
            }
            <span class="meta-chip" style="background:rgba(255,255,255,0.2);color:white;">⏰ Responds quickly</span>
          </div>
        </div>

        <!-- Order summary -->
        <div class="confirm-order-summary">
          <div class="confirm-summary-row">
            <span class="confirm-summary-label">Product</span>
            <span class="confirm-summary-value">${product ? (product.emoji || '🌿') + ' ' : '🌿 '}${productName}</span>
          </div>
          <div class="confirm-summary-row">
            <span class="confirm-summary-label">Quantity</span>
            <span class="confirm-summary-value">${quantity} ${unit}${quantity>1&&unit!=='kg'?'s':''}</span>
          </div>
          ${product ? `
          <div class="confirm-summary-row">
            <span class="confirm-summary-label">Price per ${product.unit}</span>
            <span class="confirm-summary-value">₹${product.price}</span>
          </div>
          <div class="confirm-summary-row">
            <span class="confirm-summary-label">Total (est.)</span>
            <span class="confirm-summary-value total">₹${product.price * quantity}</span>
          </div>
          ` : `
          <div class="confirm-summary-row">
            <span class="confirm-summary-label">Price</span>
            <span class="confirm-summary-value" style="color:var(--text-muted);font-style:italic">Farmer will quote after accepting</span>
          </div>
          `}
          <div class="confirm-summary-row">
            <span class="confirm-summary-label">Pickup from</span>
            <span class="confirm-summary-value">${farmer.location ? farmer.location.label : 'Farmer\'s location'}</span>
          </div>
          <div class="confirm-summary-row">
            <span class="confirm-summary-label">Payment</span>
            <span class="confirm-summary-value">Pay at pickup (Cash)</span>
          </div>
        </div>

        <div style="padding:12px 16px;background:var(--warning-light);border-radius:var(--radius-md);margin-bottom:20px;font-size:var(--text-sm);color:var(--warning);">
          ⚡ Request will be sent to <strong>${farmer.name}</strong>. Once they accept, you'll get a notification to confirm the order.
        </div>

        <button class="btn btn-primary btn-full" onclick="ConsumerView._sendRequest()" id="send-request-btn">
          📤 Send Request to ${farmer.name}
        </button>
        <button class="btn btn-secondary btn-full" style="margin-top:10px" onclick="ConsumerView._backToMatches()">
          Cancel
        </button>
      </div>
    `;
  },

  _backToMatches() {
    if (!this._pendingRequest) { this.showHome(); return; }

    const { productName, quantity, unit, maxPrice } = this._pendingRequest;
    const user = Store.getCurrentUser();
    const consumerLoc = user.location || { lat: 12.9716, lng: 77.5946 };

    // Re-run a fresh broadcast so any accepted orders are reflected
    const rawResult = Matching.broadcastRequest(productName, quantity, consumerLoc);
    this._broadcastResult = rawResult;

    let displayResult = rawResult;
    if (maxPrice) {
      const filteredWith = rawResult.withInventory.filter(m => m.product && m.product.price <= maxPrice);
      displayResult = {
        withInventory:    filteredWith,
        withoutInventory: rawResult.withoutInventory,
        all:              [...filteredWith, ...rawResult.withoutInventory]
      };
    }

    this.showMatchResults(displayResult);
  },

  // ← Edit Request: goes back to form with all original values restored from state
  _backToRequestForm() {
    if (!this._pendingRequest) { this.showHome(); return; }
    const { productName, quantity, unit, maxPrice } = this._pendingRequest;
    this.showRequestForm(productName, unit, quantity, maxPrice || '');
  },


  _sendRequest() {
    const btn = document.getElementById('send-request-btn');
    btn.textContent = 'Sending...';
    btn.disabled = true;

    setTimeout(() => {
      const user = Store.getCurrentUser();
      const { product, farmer, hasInventory } = this._selectedMatch;
      const { productName, quantity, unit } = this._pendingRequest;
      const consumerLoc = user.location || { lat: 12.9716, lng: 77.5946 };

      // Get ALL farmers in range for broadcast IDs
      const broadcastResult = this._broadcastResult ||
        Matching.broadcastRequest(productName, quantity, consumerLoc);
      const matchedFarmerIds = broadcastResult.all.map(m => m.farmer.id);

      const order = Store.addOrder({
        consumerId:       user.id,
        consumerName:     user.name,
        productName,
        requestedQty:     quantity,
        unit,
        price:            product ? product.price : null,
        status:           'matched',
        consumerLocation: consumerLoc,
        matchedFarmerIds,
        targetFarmerId:   farmer.id,
        targetFarmerName: farmer.name
      });

      // ── Agent Dispatch ─────────────────────────────────────────
      // Sends REQUEST JSON to all farmer agents within 3km.
      // Farmers with matching specialties respond with RESPONSE JSON
      // and auto-create product listings in the store.
      const { responses, autoListed } = Agent.dispatchRequest(order);

      // Notify ALL farmers in the broadcast
      NotificationSystem.notifyMatchedFarmers(order, broadcastResult.all);
      NotificationSystem.updateBadge();
      if (typeof Bridge !== 'undefined') void Bridge.pushOrder(order);

      // Show contextual toast based on agent responses
      if (autoListed.length > 0) {
        Toast.success(
          `📡 Request sent! ${responses.length} farmer agent${responses.length !== 1 ? 's' : ''} responded — ` +
          `${autoListed.length} auto-listed ${productName} on your dashboard.`
        );
      } else if (responses.length > 0) {
        Toast.success(`📡 Request broadcast to ${matchedFarmerIds.length} farmers! ${responses.length} already have ${productName} listed.`);
      } else {
        Toast.success(`📡 Request broadcast to ${matchedFarmerIds.length} nearby farmers!`);
      }

      setTimeout(() => OrdersView.showDetail(order.id), 1200);
    }, 600);
  }
};

