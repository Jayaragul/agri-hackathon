/**
 * NotificationSystem — in-app notification management
 */
const NotificationSystem = {

  /**
   * Create a notification for a user
   * @param {string} userId
   * @param {string} message
   * @param {string} type  request | accepted | confirmed | ready | cancelled | info
   * @param {string|null} orderId
   */
  add(userId, message, type = 'info', orderId = null) {
    const notif = Store.addNotification({ userId, message, type, orderId });
    this.updateBadge();
    return notif;
  },

  /** Update the red badge count on the bell icon */
  updateBadge() {
    const user = Store.getCurrentUser();
    if (!user) return;
    const count = Store.getUnreadCount(user.id);
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    badge.textContent = count > 9 ? '9+' : count;
    badge.classList.toggle('hidden', count === 0);
  },

  /**
   * Notify all matched farmers that a consumer has sent a new request.
   * @param {Object} order   The newly-created order object
   * @param {Array}  matches Array of {farmer, distance, ...} from Matching.findMatches()
   */
  notifyMatchedFarmers(order, matches) {
    // matches is the broadcastResult.all array: each item has { farmer, distance, formattedDistance }
    matches.forEach(({ farmer, distance, formattedDistance }) => {
      const fd = formattedDistance || Geo.formatDistance(distance);
      this.add(
        farmer.id,
        `🛒 New request! Consumer ${fd} away needs ${order.requestedQty} ${order.unit || ''} ${order.productName}. Tap to view and accept.`,
        'request',
        order.id
      );
    });
  },


  /**
   * Notify consumer that a farmer has accepted their request
   */
  notifyConsumerAccepted(order) {
    const farmer = Store.getUserById(order.farmerId);
    const farmerName = farmer ? farmer.name : 'A farmer';
    this.add(
      order.consumerId,
      `✅ ${farmerName} has accepted your request for ${order.requestedQty} ${order.productName}. Please confirm your order.`,
      'accepted',
      order.id
    );
  },

  /**
   * Notify farmer that consumer has confirmed
   */
  notifyFarmerConfirmed(order) {
    const consumer = Store.getUserById(order.consumerId);
    const consumerName = consumer ? consumer.name : 'Consumer';
    this.add(
      order.farmerId,
      `🎉 ${consumerName} confirmed their order for ${order.requestedQty} ${order.productName}. Please prepare it for pickup.`,
      'confirmed',
      order.id
    );
  },

  /**
   * Notify consumer that order is ready for pickup
   */
  notifyConsumerReady(order) {
    const farmer = Store.getUserById(order.farmerId);
    const farmerName = farmer ? farmer.name : 'Your farmer';
    this.add(
      order.consumerId,
      `📦 Your ${order.productName} is ready! Head to ${farmerName}'s farm for pickup.`,
      'ready',
      order.id
    );
  },

  /**
   * Notify when order is cancelled
   */
  notifyBothCancelled(order, cancelledBy) {
    const msg = cancelledBy === 'farmer'
      ? `❌ Your request for ${order.productName} was cancelled by the farmer.`
      : `❌ The order for ${order.productName} was cancelled.`;

    if (order.consumerId) this.add(order.consumerId, msg, 'cancelled', order.id);
    if (order.farmerId) this.add(order.farmerId, `❌ Order for ${order.productName} was cancelled.`, 'cancelled', order.id);
  },

  /**
   * Notify other matched farmers that a request has been fulfilled by someone else
   */
  notifyOtherFarmersRequestFilled(order) {
    if (!order.matchedFarmerIds) return;
    order.matchedFarmerIds
      .filter(id => id !== order.farmerId)
      .forEach(farmerId => {
        this.add(
          farmerId,
          `ℹ️ The request for ${order.productName} you were matched with has been accepted by another farmer.`,
          'info',
          order.id
        );
      });
  },

  /** Format a timestamp as a relative time string */
  timeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);
    if (mins < 1)  return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  },

  /** Return emoji for a notification type */
  typeIcon(type) {
    const icons = {
      request:   '📩',
      accepted:  '✅',
      confirmed: '🎉',
      ready:     '📦',
      cancelled: '❌',
      info:      'ℹ️'
    };
    return icons[type] || icons.info;
  }
};
