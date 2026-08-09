/**
 * OrdersView — Order list and order detail with full status timeline
 */
const OrdersView = {

  // ── Order List ─────────────────────────────────────────────────

  show() {
    Nav.push({ view: 'orders' });
    const user = Store.getCurrentUser();
    if (!user) return;

    Navbar.render(user.role, 'orders');
    NotificationSystem.updateBadge();

    const orders = user.role === 'farmer'
      ? Store.getOrdersByFarmer(user.id)
      : Store.getOrdersByConsumer(user.id);

    const content = document.getElementById('app-content');
    content.innerHTML = `
      <div class="page">
        <div class="page-title">${user.role === 'farmer' ? 'Order History' : 'My Orders'} 📦</div>

        ${orders.length === 0
          ? `<div class="empty-state">
               <div class="empty-state-icon">📭</div>
               <div class="empty-state-title">No orders yet</div>
               <div class="empty-state-msg">
                 ${user.role === 'consumer'
                   ? 'Request a product from the home screen to see your orders here.'
                   : 'When you accept consumer requests, orders will appear here.'}
               </div>
             </div>`
          : orders.map((o, i) => this._renderOrderCard(o, user, i)).join('')
        }
      </div>
    `;
  },

  _renderOrderCard(order, user, index) {
    const isConsumer = user.role === 'consumer';
    const otherParty = isConsumer
      ? (order.farmerName  || 'Awaiting farmer')
      : (order.consumerName || 'Consumer');

    const statusLabel = this._statusLabel(order.status);
    const statusClass = `status-${order.status}`;
    const timeAgo = NotificationSystem.timeAgo(order.createdAt);

    return `
      <div class="order-card" onclick="OrdersView.showDetail('${order.id}')"
           style="animation-delay:${index*0.06}s">
        <div class="order-card-header">
          <div>
            <div class="order-product-name">${order.productName || 'Product'}</div>
            <div class="order-meta">
              <span>${order.requestedQty} ${order.unit || 'pc'}</span>
              ${order.price ? `<span>₹${order.price * order.requestedQty}</span>` : ''}
            </div>
          </div>
          <span class="status-badge ${statusClass}">${statusLabel}</span>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:var(--text-xs);color:var(--text-muted);">
          <span>${isConsumer ? '🌾' : '👤'} ${otherParty}</span>
          <span>${timeAgo}</span>
        </div>
      </div>
    `;
  },

  // ── Order Detail ───────────────────────────────────────────────

  showDetail(orderId) {
    Nav.push({ view: 'order-detail', orderId });
    const order = Store.getOrderById(orderId);
    const user  = Store.getCurrentUser();
    if (!order || !user) return;

    Navbar.render(user.role, 'orders');
    NotificationSystem.updateBadge();

    const isConsumer = user.role === 'consumer';
    const isFarmer   = user.role === 'farmer';
    const product = order.productId ? Store.getProductById(order.productId) : null;

    const content = document.getElementById('app-content');
    content.innerHTML = `
      <div class="order-detail-page">
        <button class="back-btn" onclick="OrdersView.show()">← All Orders</button>

        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <div class="form-page-title" style="margin-bottom:0">Order Details</div>
          <span class="status-badge status-${order.status}">${this._statusLabel(order.status)}</span>
        </div>

        <!-- Order Summary Card -->
        <div class="order-summary-card">
          <div class="order-summary-row">
            <span class="order-summary-label">Product</span>
            <span class="order-summary-value">${product ? (product.emoji || '🌿') + ' ' : '🌿 '}${order.productName}</span>
          </div>
          <div class="order-summary-row">
            <span class="order-summary-label">Quantity</span>
            <span class="order-summary-value">${order.requestedQty} ${order.unit || 'piece'}${order.requestedQty>1?'s':''}</span>
          </div>
          ${order.price ? `
          <div class="order-summary-row">
            <span class="order-summary-label">Price per unit</span>
            <span class="order-summary-value">₹${order.price}</span>
          </div>
          <div class="order-summary-row">
            <span class="order-summary-label">Total (est.)</span>
            <span class="order-summary-value" style="color:var(--primary);font-weight:800;">₹${order.price * order.requestedQty}</span>
          </div>
          ` : ''}
          ${order.farmerName ? `
          <div class="order-summary-row">
            <span class="order-summary-label">Farmer</span>
            <span class="order-summary-value">🌾 ${order.farmerName}</span>
          </div>
          ` : ''}
          ${order.consumerName ? `
          <div class="order-summary-row">
            <span class="order-summary-label">Consumer</span>
            <span class="order-summary-value">👤 ${order.consumerName}</span>
          </div>
          ` : ''}
          <div class="order-summary-row">
            <span class="order-summary-label">Pickup</span>
            <span class="order-summary-value">Cash on Pickup</span>
          </div>
        </div>

        <!-- Status Timeline -->
        <div style="margin-bottom:16px;font-weight:700;font-size:var(--text-base);">Order Progress</div>
        <div class="order-timeline">
          ${this._renderTimeline(order)}
        </div>

        <!-- Action Buttons based on status + role -->
        <div style="margin-top:16px;">
          ${this._renderActions(order, user)}
        </div>
      </div>
    `;
  },

  _renderTimeline(order) {
    const steps = [
      { key: 'requested', label: 'Request Placed',   icon: '📤', desc: 'Consumer sent a request' },
      { key: 'matched',   label: 'Farmers Notified', icon: '📩', desc: 'Nearby farmers alerted' },
      { key: 'accepted',  label: 'Farmer Accepted',  icon: '🤝', desc: 'A farmer accepted your request' },
      { key: 'confirmed', label: 'Order Confirmed',  icon: '✅', desc: 'Consumer confirmed the order' },
      { key: 'ready',     label: 'Ready for Pickup', icon: '📦', desc: 'Produce is packed and ready' },
      { key: 'completed', label: 'Completed',        icon: '🎉', desc: 'Order picked up successfully' }
    ];

    const statusOrder = ['requested', 'matched', 'accepted', 'confirmed', 'ready', 'picked_up', 'completed'];
    const currentIdx  = statusOrder.indexOf(order.status);

    if (order.status === 'cancelled') {
      return `
        <div style="text-align:center;padding:24px;background:var(--danger-light);border-radius:var(--radius-lg);">
          <div style="font-size:36px;margin-bottom:12px;">❌</div>
          <div style="font-weight:700;color:var(--danger);">Order Cancelled</div>
          <div style="font-size:var(--text-xs);color:var(--text-muted);margin-top:4px;">
            ${order.timestamps && order.timestamps.cancelled
              ? new Date(order.timestamps.cancelled).toLocaleString()
              : ''}
          </div>
        </div>
      `;
    }

    return `
      <div class="timeline-steps">
        ${steps.map((step, i) => {
          const stepStatusIdx = statusOrder.indexOf(step.key);
          const isDone    = stepStatusIdx < currentIdx;
          const isCurrent = step.key === order.status;
          const isPending = stepStatusIdx > currentIdx;

          const dotClass   = isDone ? 'done' : isCurrent ? 'current' : 'pending';
          const lineClass  = isDone ? 'done' : '';
          const labelClass = isPending ? 'pending' : '';

          const timestamp = order.timestamps && order.timestamps[step.key]
            ? new Date(order.timestamps[step.key]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : null;

          const isLast = i === steps.length - 1;

          return `
            <div class="timeline-step">
              <div class="timeline-step-left">
                <div class="timeline-dot ${dotClass}">${isDone ? '✓' : isCurrent ? step.icon : ''}</div>
                ${!isLast ? `<div class="timeline-line ${lineClass}"></div>` : ''}
              </div>
              <div class="timeline-step-content">
                <div class="timeline-step-label ${labelClass}">${step.label}</div>
                ${isCurrent || isDone
                  ? `<div class="timeline-step-desc">${step.desc}</div>`
                  : ''}
                ${timestamp ? `<div class="timeline-step-time">${timestamp}</div>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  _renderActions(order, user) {
    const isConsumer = user.role === 'consumer';
    const isFarmer   = user.role === 'farmer';

    // Consumer: confirm accepted order
    if (isConsumer && order.status === 'accepted') {
      return `
        <div style="background:var(--primary-light);padding:16px;border-radius:var(--radius-lg);margin-bottom:12px;">
          <div style="font-weight:700;color:var(--primary);margin-bottom:4px;">🌾 Farmer has accepted!</div>
          <div style="font-size:var(--text-sm);color:var(--text-secondary);">
            ${order.farmerName} is ready to fulfill your order. Please confirm to proceed.
          </div>
        </div>
        <button class="btn btn-primary btn-full" onclick="OrdersView._confirmOrder('${order.id}')">
          ✅ Confirm Order
        </button>
        <button class="btn btn-secondary btn-full" style="margin-top:8px;" onclick="OrdersView._cancelOrder('${order.id}', 'consumer')">
          Cancel Order
        </button>
      `;
    }

    // Farmer: mark as ready (after consumer confirms)
    if (isFarmer && order.status === 'confirmed') {
      return `
        <div style="background:var(--info-light);padding:16px;border-radius:var(--radius-lg);margin-bottom:12px;">
          <div style="font-weight:700;color:var(--info);margin-bottom:4px;">📋 Order confirmed by consumer!</div>
          <div style="font-size:var(--text-sm);color:var(--text-secondary);">
            Please prepare ${order.requestedQty} ${order.unit || 'piece'}(s) of ${order.productName} for pickup.
          </div>
        </div>
        <button class="btn btn-accent btn-full" onclick="OrdersView._markReady('${order.id}')">
          📦 Mark as Ready for Pickup
        </button>
      `;
    }

    // Consumer: order ready for pickup
    if (isConsumer && order.status === 'ready') {
      return `
        <div style="background:var(--accent-light);padding:16px;border-radius:var(--radius-lg);margin-bottom:12px;">
          <div style="font-weight:700;color:var(--accent-dark);margin-bottom:4px;">📦 Your order is ready!</div>
          <div style="font-size:var(--text-sm);color:var(--text-secondary);">
            Head to ${order.farmerName}'s location to pick up your ${order.productName}.
          </div>
        </div>
        <button class="btn btn-primary btn-full" onclick="OrdersView._completeOrder('${order.id}')">
          🎉 I've Picked Up My Order
        </button>
      `;
    }

    // Farmer: mark ready alternative (in case consumer marks complete)
    if (isFarmer && order.status === 'ready') {
      return `
        <div style="background:var(--accent-light);padding:16px;border-radius:var(--radius-lg);">
          <div style="font-weight:700;color:var(--accent-dark);">📦 Waiting for consumer to pick up</div>
          <div style="font-size:var(--text-sm);color:var(--text-secondary);margin-top:4px;">
            Please keep the order ready. Consumer is on their way.
          </div>
        </div>
      `;
    }

    // Both: cancel option for in-progress orders
    if (['matched', 'accepted'].includes(order.status)) {
      const who = isConsumer ? 'consumer' : 'farmer';
      return `
        <button class="btn btn-secondary btn-full" onclick="OrdersView._cancelOrder('${order.id}', '${who}')">
          Cancel Order
        </button>
      `;
    }

    // Completed
    if (order.status === 'completed') {
      return `
        <div style="text-align:center;padding:20px;background:var(--success-light);border-radius:var(--radius-lg);">
          <div style="font-size:36px;margin-bottom:8px;">🎉</div>
          <div style="font-weight:700;color:var(--success);">Order Completed!</div>
          <div style="font-size:var(--text-sm);color:var(--text-muted);margin-top:4px;">
            Thank you for using FarmConnect.
          </div>
        </div>
      `;
    }

    return '';
  },

  // ── Action Handlers ────────────────────────────────────────────

  _confirmOrder(orderId) {
    const result = Matching.consumerConfirm(orderId);
    if (!result.success) {
      Toast.error(result.message);
      return;
    }

    NotificationSystem.notifyFarmerConfirmed(result.order);
    NotificationSystem.updateBadge();
    Toast.success('Order confirmed! The farmer is preparing your produce. 🌾');
    this.showDetail(orderId);
  },

  _markReady(orderId) {
    const result = Matching.markReady(orderId);
    if (!result.success) { Toast.error('Could not update order.'); return; }

    NotificationSystem.notifyConsumerReady(result.order);
    NotificationSystem.updateBadge();
    Toast.success('Order marked as ready! Consumer has been notified. 📦');
    this.showDetail(orderId);
  },

  _completeOrder(orderId) {
    const result = Matching.completeOrder(orderId);
    if (!result.success) { Toast.error('Could not complete order.'); return; }

    NotificationSystem.updateBadge();
    Toast.success('Order completed! Thank you for using FarmConnect. 🎉');
    this.showDetail(orderId);
  },

  _cancelOrder(orderId, cancelledBy) {
    Modal.show({
      title: 'Cancel Order?',
      content: `<p style="color:var(--text-secondary)">Are you sure you want to cancel this order? This action cannot be undone.</p>`,
      actions: [
        { label: '❌ Yes, Cancel', class: 'btn-danger', onclick: `OrdersView._doCancel('${orderId}','${cancelledBy}')` },
        { label: 'Keep Order', class: 'btn-secondary', onclick: 'Modal.close()' }
      ]
    });
  },

  _doCancel(orderId, cancelledBy) {
    Modal.close();
    const order = Store.getOrderById(orderId);
    Matching.cancelOrder(orderId);
    if (order) NotificationSystem.notifyBothCancelled(order, cancelledBy);
    NotificationSystem.updateBadge();
    Toast.info('Order cancelled.');
    this.show();
  },

  // ── Helpers ────────────────────────────────────────────────────

  _statusLabel(status) {
    const labels = {
      requested:  'Requested',
      matched:    'Awaiting Farmer',
      accepted:   'Accepted',
      confirmed:  'Confirmed',
      ready:      'Ready for Pickup',
      picked_up:  'Picked Up',
      completed:  'Completed',
      cancelled:  'Cancelled'
    };
    return labels[status] || status;
  }
};
