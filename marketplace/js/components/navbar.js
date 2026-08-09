/**
 * Navbar — bottom navigation component
 */
const Navbar = {

  _consumerTabs: [
    { id: 'home',          icon: '🏠', label: 'Home',      onclick: "ConsumerView.showHome()" },
    { id: 'orders',        icon: '📦', label: 'My Orders', onclick: "OrdersView.show()" },
    { id: 'notifications', icon: '🔔', label: 'Alerts',    onclick: "NotificationsView.show()" },
    { id: 'profile',       icon: '👤', label: 'Profile',   onclick: "App.showProfile()" }
  ],

  _farmerTabs: [
    { id: 'inventory', icon: '🌿', label: 'Inventory', onclick: "FarmerView.showInventory()" },
    { id: 'requests',  icon: '📩', label: 'Requests',  onclick: "FarmerView.showRequests()" },
    { id: 'orders',    icon: '📦', label: 'Orders',    onclick: "OrdersView.show()" },
    { id: 'profile',   icon: '👤', label: 'Profile',   onclick: "App.showProfile()" }
  ],

  render(role, activeTabId) {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return;

    const tabs = role === 'farmer' ? this._farmerTabs : this._consumerTabs;

    nav.innerHTML = tabs.map(tab => `
      <button
        class="nav-tab ${tab.id === activeTabId ? 'active' : ''}"
        onclick="${tab.onclick}"
        data-tab="${tab.id}"
        aria-label="${tab.label}"
      >
        <span class="nav-icon">${tab.icon}</span>
        <span class="nav-label">${tab.label}</span>
      </button>
    `).join('');
  },

  setActive(tabId) {
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabId);
    });
  }
};
