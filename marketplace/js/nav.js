/**
 * Nav — Browser History API router
 * ────────────────────────────────────────────────────────────────
 *
 * Makes the browser's native ← → buttons work inside the SPA.
 *
 * HOW IT WORKS:
 *   1. Every view calls Nav.push({ view, ...data }) when it renders
 *   2. This calls history.pushState() so the browser records the step
 *   3. When the user presses the browser ← button, `popstate` fires
 *   4. Nav._restore() calls the right view function to go back
 *
 * RULES:
 *   - Nav.push() is a no-op while restoring (prevents double-push)
 *   - Nav.replace() replaces the current entry (used for initial state)
 *   - All view functions must call Nav.push() at their very start
 * ────────────────────────────────────────────────────────────────
 */
const Nav = {

  _restoring: false,  // true while popstate is being handled

  /**
   * Push a new browser history entry.
   * Call this at the top of every navigable view function.
   * @param {Object} state  Must include a `view` string key
   */
  push(state) {
    if (this._restoring) return;   // don't push while going back
    history.pushState(state, '');
  },

  /**
   * Replace the current history entry (used on initial load / login).
   */
  replace(state) {
    history.replaceState(state, '');
  },

  /**
   * Initialize the popstate listener. Call once after login.
   */
  init() {
    window.addEventListener('popstate', (e) => {
      if (!e.state) {
        // Navigated to the very start — go to role home
        this._goHome();
        return;
      }
      this._restoring = true;
      try {
        this._restore(e.state);
      } finally {
        this._restoring = false;
      }
    });
  },

  // ── Restore a view from a saved state object ─────────────────

  _restore(state) {
    switch (state.view) {

      // ── Consumer ──────────────────────────────────────────────
      case 'consumer-home':
        ConsumerView.showHome();
        break;

      case 'request-form':
        ConsumerView.showRequestForm(
          state.productName || '',
          state.unit        || 'piece',
          state.qty         || '',
          state.maxPrice    || ''
        );
        break;

      case 'match-results':
        // Re-run broadcast so fresh accepted statuses are reflected
        if (ConsumerView._pendingRequest) {
          ConsumerView._backToMatches();
        } else {
          ConsumerView.showHome();
        }
        break;

      case 'order-confirm':
        if (ConsumerView._selectedMatch && ConsumerView._pendingRequest) {
          ConsumerView.showOrderConfirmation();
        } else {
          ConsumerView.showHome();
        }
        break;

      // ── Farmer ────────────────────────────────────────────────
      case 'farmer-inventory':
        FarmerView.showInventory();
        break;

      case 'farmer-requests':
        FarmerView.showRequests();
        break;

      case 'farmer-push':
        FarmerView.showPushForm();
        break;

      case 'farmer-add':
        FarmerView.showAddProduct();
        break;

      case 'farmer-edit':
        FarmerView.showEditProduct(state.productId);
        break;

      // ── Orders ────────────────────────────────────────────────
      case 'orders':
        OrdersView.show();
        break;

      case 'order-detail':
        OrdersView.showDetail(state.orderId);
        break;

      // ── Shared ────────────────────────────────────────────────
      case 'notifications':
        if (typeof NotificationsView !== 'undefined') NotificationsView.show();
        break;

      default:
        this._goHome();
    }
  },

  _goHome() {
    const user = Store.getCurrentUser();
    if (!user) return;
    if (user.role === 'farmer') FarmerView.showInventory();
    else ConsumerView.showHome();
  }
};
