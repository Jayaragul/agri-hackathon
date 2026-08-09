/**
 * App — main entry point, router, and global profile actions
 */
const App = {

  init() {
    const user = Store.getCurrentUser();
    if (user) {
      this.showMainApp(user);
    } else {
      this.showAuth();
    }
    if (typeof Bridge !== 'undefined') Bridge.start();
  },

  // ── Auth ─────────────────────────────────────────────────────

  showAuth() {
    document.body.classList.add('auth-mode');
    const header = document.getElementById('app-header');
    const nav    = document.getElementById('bottom-nav');
    if (header) header.classList.add('hidden');
    if (nav)    nav.classList.add('hidden');

    AuthView.show();
  },

  // ── Main App ─────────────────────────────────────────────────

  showMainApp(user) {
    document.body.classList.remove('auth-mode');
    const freshUser = Store.getUserById(user.id) || user;

    const header = document.getElementById('app-header');
    const nav    = document.getElementById('bottom-nav');
    if (header) header.classList.remove('hidden');
    if (nav)    nav.classList.remove('hidden');

    const avatar = document.getElementById('user-avatar');
    if (avatar) {
      avatar.textContent = freshUser.name.charAt(0).toUpperCase();
      avatar.title = freshUser.name;
    }

    NotificationSystem.updateBadge();

    // Start the browser history router
    Nav.init();
    const homeState = freshUser.role === 'farmer'
      ? { view: 'farmer-inventory' }
      : { view: 'consumer-home' };
    Nav.replace(homeState);

    if (freshUser.role === 'consumer') {
      ConsumerView.showHome();
    } else {
      FarmerView.showInventory();
    }
  },

  // ── Profile Modal ────────────────────────────────────────────

  showProfile() {
    const user = Store.getCurrentUser();
    if (!user) return;

    Modal.show({
      title: 'My Profile',
      content: `
        <div class="profile-modal">
          <div class="profile-avatar-large">${user.name.charAt(0).toUpperCase()}</div>
          <div class="profile-name">${user.name}</div>
          <div class="profile-phone">📞 ${user.phone}</div>
          <div style="margin:8px auto;display:inline-block">
            <span class="profile-role">${user.role === 'farmer' ? '🌾 Farmer' : '🛒 Consumer'}</span>
          </div>
          <div class="profile-location" style="margin-top:12px;">
            📍 ${user.location ? user.location.label : 'Location not set'}
          </div>
        </div>
      `,
      actions: [
        { label: '🔓 Logout', class: 'btn-danger', onclick: 'App.logout()' },
        { label: 'Close',     class: 'btn-secondary', onclick: 'Modal.close()' }
      ]
    });
  },

  logout() {
    Auth.logout();
    Modal.close();
    Toast.info('Logged out. See you soon! 👋');
    setTimeout(() => this.showAuth(), 500);
  }
};

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
