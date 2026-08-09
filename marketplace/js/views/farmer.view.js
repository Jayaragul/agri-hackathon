/**
 * FarmerView — Inventory Dashboard, Add/Edit Product, Incoming Requests
 */
const FarmerView = {

  // ── Inventory Dashboard ────────────────────────────────────────

  showInventory() {
    Nav.push({ view: 'farmer-inventory' });
    const user = Store.getCurrentUser();
    if (!user) return;

    Navbar.render('farmer', 'inventory');
    NotificationSystem.updateBadge();

    const products = Store.getProductsByFarmer(user.id);
    const pendingCount = Store.getPendingRequestsForFarmer(user.id).length;
    const totalQty = products.reduce((sum, p) => sum + (p.quantity - (p.reservedQty||0)), 0);
    const completedOrders = Store.getOrdersByFarmer(user.id).filter(o => o.status === 'completed').length;

    const content = document.getElementById('app-content');
    content.innerHTML = `
      <!-- Dashboard Header -->
      <div class="inventory-header">
        <div class="inventory-greeting">Hello, ${user.name} 🌾</div>
        <div class="inventory-subtitle">${user.location ? user.location.label : 'Farmer'}</div>
        <div class="inventory-stats" style="margin-top:16px;">
          <div class="stat-card">
            <div class="stat-value">${products.length}</div>
            <div class="stat-label">Products</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${pendingCount}</div>
            <div class="stat-label">Requests</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${completedOrders}</div>
            <div class="stat-label">Completed</div>
          </div>
        </div>
      </div>

      <!-- Pending Requests Alert -->
      ${pendingCount > 0 ? `
        <div style="margin:16px;padding:14px 16px;background:var(--warning-light);border:1.5px solid var(--warning);border-radius:var(--radius-lg);cursor:pointer;display:flex;align-items:center;justify-content:space-between;"
             onclick="FarmerView.showRequests()">
          <div>
            <div style="font-weight:700;color:var(--warning);">⚡ ${pendingCount} new request${pendingCount>1?'s':''} waiting</div>
            <div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:2px;">Tap to view and accept</div>
          </div>
          <span style="font-size:20px;">→</span>
        </div>
      ` : ''}

      <!-- Inventory Section Header -->
      <div class="section-header" style="padding-top:8px;">
        <div class="section-title">My Produce</div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-accent btn-sm" onclick="FarmerView.showPushForm()">
            🚀 Push
          </button>
          <button class="btn btn-primary btn-sm" onclick="FarmerView.showAddProduct()">+ Add</button>
        </div>
      </div>

      <!-- Inventory List -->
      <div class="inventory-list" id="inventory-list">
        ${products.length === 0
          ? `<div class="empty-state">
               <div class="empty-state-icon">🌱</div>
               <div class="empty-state-title">No products yet</div>
               <div class="empty-state-msg">You'll receive broadcast requests from nearby consumers automatically.<br>Or push your availability right now to alert all consumers within 3 km.</div>
               <div style="display:flex;gap:10px;margin-top:16px;justify-content:center;flex-wrap:wrap;">
                 <button class="btn btn-accent" onclick="FarmerView.showPushForm()">🚀 Push Availability</button>
                 <button class="btn btn-primary" onclick="FarmerView.showAddProduct()">+ Add Produce</button>
               </div>
             </div>`
          : products.map((p, i) => this._renderInventoryItem(p, i)).join('')
        }
      </div>
    `;
  },

  _renderInventoryItem(p, index) {
    const available = p.quantity - (p.reservedQty || 0);
    const isLow = available <= 2;

    return `
      <div class="inventory-item" style="animation-delay:${index*0.06}s">
        <div class="inventory-item-emoji">${p.emoji || '🌿'}</div>
        <div class="inventory-item-info">
          <div class="inventory-item-name">
            ${p.name}
            ${p.agentGenerated ? '<span class="agent-badge-sm">🤖 Auto-listed</span>' : ''}
          </div>
          <div class="inventory-item-category">${p.category}</div>
          <div class="inventory-item-stock" style="color:${isLow?'var(--danger)':'var(--text-secondary)'}">
            ${isLow ? '⚠️' : '📦'} ${available} ${p.unit} available
            ${p.reservedQty > 0 ? `<span style="color:var(--warning);font-size:var(--text-xs);"> (${p.reservedQty} reserved)</span>` : ''}
          </div>
        </div>
        <div class="inventory-item-actions">
          <div class="inventory-item-price">₹${p.price}<span style="font-size:var(--text-xs);color:var(--text-muted);font-weight:400;">/${p.unit}</span></div>
          <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;justify-content:flex-end;">
            <button class="btn btn-sm btn-accent" onclick="FarmerView._pushProduct('${p.id}')">🚀</button>
            <button class="btn btn-sm btn-ghost" onclick="FarmerView.showEditProduct('${p.id}')">Edit</button>
            <button class="btn btn-sm btn-secondary" onclick="FarmerView._deleteProduct('${p.id}')">🗑</button>
          </div>
        </div>
      </div>
    `;
  },

  _deleteProduct(id) {
    const product = Store.getProductById(id);
    if (!product) return;

    Modal.show({
      title: 'Delete Product',
      content: `<p style="color:var(--text-secondary)">Are you sure you want to remove <strong>${product.name}</strong> from your inventory?</p>`,
      actions: [
        { label: '🗑 Yes, Delete', class: 'btn-danger', onclick: `FarmerView._confirmDelete('${id}')` },
        { label: 'Cancel', class: 'btn-secondary', onclick: 'Modal.close()' }
      ]
    });
  },

  _confirmDelete(id) {
    Store.deleteProduct(id);
    Modal.close();
    Toast.success('Product removed from inventory.');
    this.showInventory();
  },

  // ── Push Availability Form ────────────────────────────────────

  showPushForm(prefillName = '', prefillPrice = '', prefillQty = '', prefillUnit = 'piece') {
    Nav.push({ view: 'farmer-push' });
    const user = Store.getCurrentUser();
    const myProducts = Store.getProductsByFarmer(user.id);
    const units = ['piece', 'kg', 'bunch', 'litre', 'gram'];
    const guide = Object.keys(Agent.PRODUCE_GUIDE);

    // Combine farmer's own products + specialties + guide for suggestions
    const suggestions = [
      ...myProducts.map(p => p.name),
      ...(user.specialties || []),
      ...guide
    ].filter((v, i, a) => a.indexOf(v) === i).sort();

    const content = document.getElementById('app-content');
    content.innerHTML = `
      <div class="add-product-page">
        <button class="back-btn" onclick="FarmerView.showInventory()">← Back</button>

        <div class="form-page-header">
          <div class="form-page-title">🚀 Push Availability</div>
          <div class="form-page-subtitle">
            Instantly alert <strong>all consumers within 3 km</strong> that you have produce available.
            Their dashboard updates in real time.
          </div>
        </div>

        <!-- Push info bar -->
        <div class="broadcast-info-bar" style="background:#F5F0FF;border-color:#C4B5FD;color:#7C3AED;">
          <span>🚀</span>
          <span>Consumers nearby will get a <strong>notification</strong> and see your product on their home page immediately.</span>
        </div>

        <form id="push-form" onsubmit="FarmerView._handlePush(event)">

          <div class="form-group" style="position:relative;">
            <label for="push-product">What do you have? *</label>
            <input class="form-control" type="text" id="push-product"
                   placeholder="e.g. Tomato, Drumstick, Spinach..."
                   value="${prefillName}"
                   oninput="FarmerView._showPushSuggestions(this.value, ${JSON.stringify(suggestions)})"
                   onfocus="FarmerView._showPushSuggestions(this.value, ${JSON.stringify(suggestions)})"
                   autocomplete="off" required>
            <div id="push-suggestions" class="suggestions-list hidden"></div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="push-qty">Quantity available *</label>
              <input class="form-control" type="number" id="push-qty"
                     placeholder="e.g. 10" min="1" value="${prefillQty}" required>
            </div>
            <div class="form-group">
              <label for="push-unit">Unit *</label>
              <select class="form-control" id="push-unit">
                ${units.map(u => `<option value="${u}" ${u===prefillUnit?'selected':''}>${u}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-group">
            <label for="push-price">Your Price (₹ per unit) *</label>
            <input class="form-control" type="number" id="push-price"
                   placeholder="e.g. 10" min="0.5" step="0.5" value="${prefillPrice}" required>
          </div>

          <div style="padding:12px 16px;background:var(--primary-light);border-radius:var(--radius-md);margin-bottom:20px;font-size:var(--text-sm);color:var(--primary);">
            📍 Push from: <strong>${user.location ? user.location.label : 'Your registered location'}</strong>
          </div>

          <button type="submit" class="btn btn-accent btn-full" id="push-btn">
            🚀 Push to Nearby Consumers
          </button>
        </form>
      </div>
    `;
  },

  _showPushSuggestions(query, suggestions) {
    const box = document.getElementById('push-suggestions');
    if (!box) return;
    if (!query) { box.classList.add('hidden'); return; }
    const matched = suggestions.filter(s => s.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
    if (!matched.length) { box.classList.add('hidden'); return; }
    box.innerHTML = matched.map(s =>
      `<div class="suggestion-item" onclick="document.getElementById('push-product').value='${s}';document.getElementById('push-suggestions').classList.add('hidden');FarmerView._autofillPushGuide('${s}');">🌿 ${s}</div>`
    ).join('');
    box.classList.remove('hidden');
  },

  _autofillPushGuide(name) {
    const guide = Agent._getGuide(name);
    const priceEl = document.getElementById('push-price');
    const unitEl  = document.getElementById('push-unit');
    if (priceEl && !priceEl.value) priceEl.value = guide.price;
    if (unitEl)  unitEl.value = guide.unit;
  },

  _handlePush(e) {
    e.preventDefault();
    const user  = Store.getCurrentUser();
    const name  = document.getElementById('push-product').value.trim();
    const qty   = parseInt(document.getElementById('push-qty').value);
    const unit  = document.getElementById('push-unit').value;
    const price = parseFloat(document.getElementById('push-price').value);

    if (!name || !qty || !price) { Toast.error('Please fill all required fields.'); return; }

    const btn = document.getElementById('push-btn');
    btn.textContent = 'Pushing...';
    btn.disabled = true;

    setTimeout(() => {
      const guide = Agent._getGuide(name);
      const { received, product } = Agent.pushAvailability(user, {
        name,
        quantity:  qty,
        unit,
        price,
        category:  guide.category,
        emoji:     guide.emoji
      });

      NotificationSystem.updateBadge();

      if (received.length > 0) {
        Toast.success(
          `🚀 Pushed! ${received.length} consumer${received.length !== 1 ? 's' : ''} within 3 km notified about your ${name}.`
        );
      } else {
        Toast.info('Push sent — no consumers registered within 3 km yet. Product is live on the marketplace.');
      }

      setTimeout(() => this.showInventory(), 800);
    }, 500);
  },

  _pushProduct(productId) {
    const p = Store.getProductById(productId);
    if (!p) return;
    const user = Store.getCurrentUser();

    setTimeout(() => {
      const { received } = Agent.pushAvailability(user, {
        name:     p.name,
        quantity: p.quantity - (p.reservedQty || 0),
        unit:     p.unit,
        price:    p.price,
        category: p.category,
        emoji:    p.emoji
      });
      NotificationSystem.updateBadge();
      if (received.length > 0) {
        Toast.success(`🚀 ${p.name} pushed to ${received.length} nearby consumer${received.length !== 1 ? 's' : ''}!`);
      } else {
        Toast.info('Push sent — no consumers within 3 km registered yet.');
      }
    }, 300);
  },

  // ── Add / Edit Product Form ────────────────────────────────────

  showAddProduct() {
    this._showProductForm(null);
  },

  showEditProduct(productId) {
    const p = Store.getProductById(productId);
    if (!p) return;
    this._showProductForm(p);
  },

  _showProductForm(existing) {
    Nav.push(existing ? { view: 'farmer-edit', productId: existing.id } : { view: 'farmer-add' });
    const user = Store.getCurrentUser();
    const isEdit = !!existing;
    const title = isEdit ? 'Edit Product' : 'Add New Produce';

    const categories = ['Vegetables', 'Leafy Greens', 'Fruits', 'Spices', 'Grains', 'Dairy', 'Other'];
    const units = ['piece', 'kg', 'bunch', 'litre', 'gram'];
    const emojis = ['🌿', '🍅', '🥬', '🥦', '🧅', '🥔', '🍆', '🌽', '🫑', '🌶️', '🥥', '🍌', '🍊', '🍋', '🫘', '🌾'];

    const content = document.getElementById('app-content');
    content.innerHTML = `
      <div class="add-product-page">
        <button class="back-btn" onclick="FarmerView.showInventory()">← Back to Inventory</button>

        <div class="form-page-header">
          <div class="form-page-title">${title}</div>
          <div class="form-page-subtitle">This will be visible to consumers within 3 km of you</div>
        </div>

        <form id="add-product-form" onsubmit="FarmerView._handleProductSave(event, '${existing ? existing.id : ''}')">

          <!-- Emoji picker -->
          <div class="form-group">
            <label>Icon</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px;padding:12px;background:var(--surface);border-radius:var(--radius-md);">
              ${emojis.map(em => `
                <div class="emoji-pick ${(existing && existing.emoji===em)||(!existing&&em==='🌿')?'selected':''}"
                     onclick="FarmerView._pickEmoji('${em}', this)"
                     style="font-size:28px;cursor:pointer;padding:4px 8px;border-radius:8px;border:2px solid ${(existing && existing.emoji===em)?'var(--primary)':'transparent'};transition:border 0.15s;">
                  ${em}
                </div>
              `).join('')}
            </div>
            <input type="hidden" id="prod-emoji" value="${existing ? existing.emoji : '🌿'}">
          </div>

          <div class="form-group">
            <label for="prod-name">Product Name *</label>
            <input class="form-control" type="text" id="prod-name"
                   value="${existing ? existing.name : ''}"
                   placeholder="e.g. Drumstick, Tomato, Spinach..." required>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="prod-category">Category *</label>
              <select class="form-control" id="prod-category">
                ${categories.map(c => `<option value="${c}" ${existing&&existing.category===c?'selected':''}>${c}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label for="prod-unit">Unit *</label>
              <select class="form-control" id="prod-unit">
                ${units.map(u => `<option value="${u}" ${existing&&existing.unit===u?'selected':''}>${u}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="prod-qty">Quantity *</label>
              <input class="form-control" type="number" id="prod-qty"
                     value="${existing ? existing.quantity : ''}"
                     placeholder="Available stock" min="1" required>
            </div>
            <div class="form-group">
              <label for="prod-price">Price (₹) *</label>
              <input class="form-control" type="number" id="prod-price"
                     value="${existing ? existing.price : ''}"
                     placeholder="Per unit" min="0.5" step="0.5" required>
            </div>
          </div>

          <!-- Location (use farmer's registered location) -->
          <div style="padding:12px 16px;background:var(--primary-light);border-radius:var(--radius-md);margin-bottom:20px;font-size:var(--text-sm);color:var(--primary);">
            📍 Pickup location: <strong>${user.location ? user.location.label : 'Your registered location'}</strong>
          </div>

          <button type="submit" class="btn btn-primary btn-full">
            ${isEdit ? '✅ Update Product' : '+ Add to Inventory'}
          </button>
        </form>
      </div>
    `;
  },

  _pickEmoji(emoji, el) {
    document.querySelectorAll('.emoji-pick').forEach(e => {
      e.style.borderColor = 'transparent';
    });
    el.style.borderColor = 'var(--primary)';
    document.getElementById('prod-emoji').value = emoji;
  },

  _handleProductSave(e, existingId) {
    e.preventDefault();
    const user = Store.getCurrentUser();

    const name     = document.getElementById('prod-name').value.trim();
    const category = document.getElementById('prod-category').value;
    const unit     = document.getElementById('prod-unit').value;
    const quantity = parseInt(document.getElementById('prod-qty').value);
    const price    = parseFloat(document.getElementById('prod-price').value);
    const emoji    = document.getElementById('prod-emoji').value;

    if (!name || !quantity || !price) {
      Toast.error('Please fill all required fields.');
      return;
    }

    const productData = {
      farmerId: user.id,
      farmerName: user.name,
      name, category, unit, quantity, price, emoji,
      location: user.location || { lat: 12.9716, lng: 77.5946 }
    };

    if (existingId) {
      Store.updateProduct(existingId, productData);
      Toast.success(`${name} updated! ✅`);
    } else {
      Store.addProduct(productData);
      Toast.success(`${name} added to your inventory! 🌿`);
    }

    setTimeout(() => this.showInventory(), 400);
  },

  // ── Incoming Requests ──────────────────────────────────────────

  showRequests() {
    Nav.push({ view: 'farmer-requests' });
    const user = Store.getCurrentUser();
    if (!user) return;

    Navbar.render('farmer', 'requests');
    NotificationSystem.updateBadge();

    const pendingOrders = Store.getPendingRequestsForFarmer(user.id);
    const myProducts    = Store.getProductsByFarmer(user.id);

    const content = document.getElementById('app-content');
    content.innerHTML = `
      <div class="page">
        <div class="page-title">Incoming Requests 📩</div>

        ${pendingOrders.length === 0
          ? `<div class="empty-state">
               <div class="empty-state-icon">📭</div>
               <div class="empty-state-title">No pending requests</div>
               <div class="empty-state-msg">Consumer requests matching your inventory within 3 km will appear here in real time.</div>
             </div>`
          : `<div class="requests-list">${pendingOrders.map((order, i) => this._renderRequestCard(order, myProducts, i)).join('')}</div>`
        }
      </div>
    `;
  },

  _renderRequestCard(order, myProducts, index) {
    // Look for a matching listed product (optional)
    const matchingProduct = myProducts.find(p =>
      p.name.toLowerCase().includes(order.productName.toLowerCase()) &&
      (p.quantity - (p.reservedQty || 0)) >= order.requestedQty
    );

    const consumer = Store.getUserById(order.consumerId);
    const farmerLoc = Store.getCurrentUser().location || { lat: 12.9716, lng: 77.5946 };
    const distance  = consumer && consumer.location
      ? Geo.haversineDistance(consumer.location, farmerLoc)
      : null;

    const timeAgo = NotificationSystem.timeAgo(order.createdAt);
    const isTarget = order.targetFarmerId === Store.getCurrentUser().id;

    return `
      <div class="request-card ${isTarget ? 'direct-request' : ''}" style="animation-delay:${index*0.07}s">
        ${isTarget ? '<div class="direct-request-badge">📌 Direct Request</div>' : ''}

        <div class="request-card-header">
          <div>
            <div class="request-consumer-name">👤 ${order.consumerName}</div>
            ${distance ? `<div style="font-size:var(--text-xs);color:var(--primary);font-weight:600;">📍 ${Geo.formatDistance(distance)} away</div>` : ''}
          </div>
          <div class="request-time">${timeAgo}</div>
        </div>

        <div class="request-product-info">
          <div class="request-product-emoji">${matchingProduct ? (matchingProduct.emoji || '🌿') : '🌿'}</div>
          <div class="request-product-details">
            <strong>${order.requestedQty} ${order.unit || 'piece'}${order.requestedQty > 1 && (order.unit === 'piece' || !order.unit) ? 's' : ''} of ${order.productName}</strong>
            ${matchingProduct
              ? `<span>✅ Your stock: ${matchingProduct.quantity - (matchingProduct.reservedQty||0)} available · ₹${matchingProduct.price}/${matchingProduct.unit}</span>`
              : `<span style="color:var(--text-muted);">📡 Broadcast — accept as a pledge if you can supply this</span>`
            }
          </div>
        </div>

        <div class="request-actions">
          ${matchingProduct
            ? `<button class="btn btn-primary"
                       onclick="FarmerView._acceptRequest('${order.id}', '${matchingProduct.id}')">
                 ✅ Accept (Stock Ready)
               </button>`
            : `<button class="btn btn-accent"
                       onclick="FarmerView._acceptRequest('${order.id}', null)">
                 ✋ Accept as Pledge
               </button>`
          }
          <button class="btn btn-secondary"
                  onclick="FarmerView._declineRequest('${order.id}')">
            ✕ Decline
          </button>
        </div>
      </div>
    `;
  },


  _acceptRequest(orderId, productId) {
    const result = Matching.farmerAccept(orderId, Store.getCurrentUser().id, productId);

    if (!result.success) {
      Toast.error(result.message);
      this.showRequests();
      return;
    }

    const order = result.order;

    // Notify consumer
    NotificationSystem.notifyConsumerAccepted(order);

    // Notify other matched farmers that this order is filled
    NotificationSystem.notifyOtherFarmersRequestFilled(order);
    NotificationSystem.updateBadge();

    Toast.success(`You accepted! ${order.consumerName}'s stock is reserved for 15 minutes. ✅`);
    setTimeout(() => this.showRequests(), 500);
  },

  _declineRequest(orderId) {
    // Remove this farmer from the matchedFarmerIds (they declined)
    const order = Store.getOrderById(orderId);
    if (!order) return;

    const userId = Store.getCurrentUser().id;
    const remaining = (order.matchedFarmerIds || []).filter(id => id !== userId);

    Store.updateOrder(orderId, { matchedFarmerIds: remaining });

    // If no farmers left, move to a 'no_match' state or keep as-is
    Toast.info('You declined this request.');
    this.showRequests();
  }
};
