/**
 * Store — localStorage data layer for FarmConnect
 *
 * FARMER SOURCES (all-to-all):
 *   1. FARMERS_DATA (data/farmers.data.js) — pre-seeded JSON database
 *   2. Manually registered farmers via the auth screen
 * Both pools are merged into the same users array.
 * Consumer requests are broadcast to ALL farmers in either pool within 3 km.
 */
const Store = {

  KEYS: {
    USERS:        'fc_users',
    PRODUCTS:     'fc_products',
    ORDERS:       'fc_orders',
    NOTIFICATIONS:'fc_notifications',
    CURRENT_USER: 'fc_current_user',
    SEEDED:       'fc_seeded_v2'   // v2 so existing v1 data re-seeds cleanly
  },

  // ── Utilities ─────────────────────────────────────────────────

  _get(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch { return []; }
  },

  _set(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  },

  uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  },

  // ── Users ─────────────────────────────────────────────────────

  getUsers() { return this._get(this.KEYS.USERS); },
  _saveUsers(users) { this._set(this.KEYS.USERS, users); },

  getUserById(id) {
    return this.getUsers().find(u => u.id === id) || null;
  },

  getUserByPhone(phone, role) {
    return this.getUsers().find(u => u.phone === phone && u.role === role) || null;
  },

  /** Returns all users with role === 'farmer' (JSON-seeded + manually registered) */
  getAllFarmers() {
    return this.getUsers().filter(u => u.role === 'farmer');
  },

  addUser(data) {
    const users = this.getUsers();
    // Prevent duplicate phone+role
    if (users.find(u => u.phone === data.phone && u.role === data.role)) return null;
    const user = { ...data, id: data.id || this.uuid(), createdAt: Date.now(), source: data.source || 'manual' };
    users.push(user);
    this._saveUsers(users);
    return user;
  },

  updateUser(id, updates) {
    const users = this.getUsers();
    const i = users.findIndex(u => u.id === id);
    if (i !== -1) {
      users[i] = { ...users[i], ...updates };
      this._saveUsers(users);
      return users[i];
    }
    return null;
  },

  // ── Session (current logged-in user) ──────────────────────────

  getCurrentUser() {
    try { return JSON.parse(localStorage.getItem(this.KEYS.CURRENT_USER)); }
    catch { return null; }
  },

  setCurrentUser(user) {
    localStorage.setItem(this.KEYS.CURRENT_USER, JSON.stringify(user));
  },

  clearCurrentUser() {
    localStorage.removeItem(this.KEYS.CURRENT_USER);
  },

  refreshCurrentUser() {
    const current = this.getCurrentUser();
    if (!current) return null;
    const fresh = this.getUserById(current.id);
    if (fresh) this.setCurrentUser(fresh);
    return fresh;
  },

  // ── Products (Optional Farmer Inventory) ─────────────────────
  // Farmers can optionally add products to appear in "Browse Produce".
  // NOT required — requests are broadcast to all nearby farmers anyway.

  getProducts() { return this._get(this.KEYS.PRODUCTS); },
  _saveProducts(p) { this._set(this.KEYS.PRODUCTS, p); },

  getProductsByFarmer(farmerId) {
    return this.getProducts().filter(p => p.farmerId === farmerId);
  },

  getProductById(id) {
    return this.getProducts().find(p => p.id === id) || null;
  },

  addProduct(data) {
    const products = this.getProducts();
    const product = { ...data, id: this.uuid(), reservedQty: 0, createdAt: Date.now() };
    products.push(product);
    this._saveProducts(products);
    return product;
  },

  updateProduct(id, updates) {
    const products = this.getProducts();
    const i = products.findIndex(p => p.id === id);
    if (i !== -1) {
      products[i] = { ...products[i], ...updates };
      this._saveProducts(products);
      return products[i];
    }
    return null;
  },

  deleteProduct(id) {
    this._saveProducts(this.getProducts().filter(p => p.id !== id));
  },

  // ── Orders ────────────────────────────────────────────────────

  getOrders() { return this._get(this.KEYS.ORDERS); },
  _saveOrders(o) { this._set(this.KEYS.ORDERS, o); },

  getOrderById(id) {
    return this.getOrders().find(o => o.id === id) || null;
  },

  getOrdersByConsumer(consumerId) {
    return this.getOrders()
      .filter(o => o.consumerId === consumerId)
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  getOrdersByFarmer(farmerId) {
    return this.getOrders()
      .filter(o => o.farmerId === farmerId)
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  /**
   * Returns orders in 'matched' (broadcast) state targeting this farmer.
   * Works for both JSON-seeded farmers and manually registered ones.
   */
  getPendingRequestsForFarmer(farmerId) {
    return this.getOrders()
      .filter(o =>
        o.status === 'matched' &&
        Array.isArray(o.matchedFarmerIds) &&
        o.matchedFarmerIds.includes(farmerId)
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  addOrder(data) {
    const orders = this.getOrders();
    const order = {
      ...data,
      id: this.uuid(),
      createdAt: Date.now(),
      timestamps: { requested: Date.now() }
    };
    orders.push(order);
    this._saveOrders(orders);
    return order;
  },

  updateOrder(id, updates) {
    const orders = this.getOrders();
    const i = orders.findIndex(o => o.id === id);
    if (i !== -1) {
      orders[i] = { ...orders[i], ...updates };
      this._saveOrders(orders);
      return orders[i];
    }
    return null;
  },

  // ── Notifications ─────────────────────────────────────────────

  getNotifications() { return this._get(this.KEYS.NOTIFICATIONS); },
  _saveNotifications(n) { this._set(this.KEYS.NOTIFICATIONS, n); },

  getNotificationsForUser(userId) {
    return this.getNotifications()
      .filter(n => n.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  getUnreadCount(userId) {
    return this.getNotifications().filter(n => n.userId === userId && !n.read).length;
  },

  addNotification(data) {
    const notifs = this.getNotifications();
    const notif = { ...data, id: this.uuid(), read: false, createdAt: Date.now() };
    notifs.push(notif);
    this._saveNotifications(notifs);
    return notif;
  },

  markAllRead(userId) {
    const notifs = this.getNotifications().map(n =>
      n.userId === userId ? { ...n, read: true } : n
    );
    this._saveNotifications(notifs);
  },

  // ── Seed ──────────────────────────────────────────────────────

  seed() {
    if (localStorage.getItem(this.KEYS.SEEDED)) {
      // Even if already seeded, sync any new farmers from FARMERS_DATA
      // (handles new entries added to the JSON file)
      this._syncFarmersFromData();
      return;
    }

    // ── 1. Seed consumers ──────────────────────────────────────
    const C1 = 'demo-consumer-1';

    const users = [
      {
        id: C1, name: 'Priya Rajan', phone: '9876543210', role: 'consumer',
        location: { lat: 12.9716, lng: 77.5946, label: 'MG Road, Bengaluru' },
        createdAt: Date.now(), source: 'demo'
      }
    ];

    // ── 2. Seed ALL farmers from FARMERS_DATA JSON ─────────────
    if (typeof FARMERS_DATA !== 'undefined' && FARMERS_DATA.farmers) {
      for (const f of FARMERS_DATA.farmers) {
        users.push({
          id: f.id,
          name: f.name,
          phone: f.phone,
          role: 'farmer',
          location: f.location,
          specialties: f.specialties || [],
          farmType: f.farmType || 'backyard',
          rating: f.rating || 4.5,
          emoji: f.emoji || '🌿',
          available: f.available !== false,
          source: 'json',   // marks this as JSON-seeded (not manually registered)
          createdAt: Date.now()
        });
      }
    }

    // ── 3. Seed optional starter inventory for the first 3 farmers ─
    const F1 = 'f-001';
    const F2 = 'f-002';
    const F3 = 'f-003';

    const products = [
      // Ram Kumar — Shivajinagar (~0.93 km)
      { id: 'p1', farmerId: F1, farmerName: 'Ram Kumar', name: 'Drumstick', category: 'Vegetables', quantity: 5, unit: 'piece', price: 10, reservedQty: 0, location: { lat: 12.9800, lng: 77.5946 }, emoji: '🥦', createdAt: Date.now() },
      { id: 'p2', farmerId: F1, farmerName: 'Ram Kumar', name: 'Tomato',    category: 'Vegetables', quantity: 10, unit: 'kg',    price: 30, reservedQty: 0, location: { lat: 12.9800, lng: 77.5946 }, emoji: '🍅', createdAt: Date.now() },
      { id: 'p3', farmerId: F1, farmerName: 'Ram Kumar', name: 'Coconut',   category: 'Fruits',     quantity: 8,  unit: 'piece', price: 20, reservedQty: 0, location: { lat: 12.9800, lng: 77.5946 }, emoji: '🥥', createdAt: Date.now() },

      // Muthu Selvam — Indiranagar (~1.34 km)
      { id: 'p4', farmerId: F2, farmerName: 'Muthu Selvam', name: 'Drumstick', category: 'Vegetables',   quantity: 8,  unit: 'piece', price: 8,  reservedQty: 0, location: { lat: 12.9716, lng: 77.6070 }, emoji: '🥦', createdAt: Date.now() },
      { id: 'p5', farmerId: F2, farmerName: 'Muthu Selvam', name: 'Spinach',   category: 'Leafy Greens', quantity: 5,  unit: 'bunch', price: 15, reservedQty: 0, location: { lat: 12.9716, lng: 77.6070 }, emoji: '🥬', createdAt: Date.now() },
      { id: 'p6', farmerId: F2, farmerName: 'Muthu Selvam', name: 'Brinjal',   category: 'Vegetables',   quantity: 6,  unit: 'kg',    price: 35, reservedQty: 0, location: { lat: 12.9716, lng: 77.6070 }, emoji: '🍆', createdAt: Date.now() },

      // Venkat Rao — Rajajinagar (~2.15 km)
      { id: 'p9',  farmerId: F3, farmerName: 'Venkat Rao', name: 'Onion',       category: 'Vegetables', quantity: 15, unit: 'kg', price: 25, reservedQty: 0, location: { lat: 12.9716, lng: 77.5750 }, emoji: '🧅', createdAt: Date.now() },
      { id: 'p10', farmerId: F3, farmerName: 'Venkat Rao', name: 'Potato',      category: 'Vegetables', quantity: 20, unit: 'kg', price: 20, reservedQty: 0, location: { lat: 12.9716, lng: 77.5750 }, emoji: '🥔', createdAt: Date.now() },
      { id: 'p11', farmerId: F3, farmerName: 'Venkat Rao', name: 'Green Chilli',category: 'Spices',     quantity: 2,  unit: 'kg', price: 60, reservedQty: 0, location: { lat: 12.9716, lng: 77.5750 }, emoji: '🌶️', createdAt: Date.now() },
    ];

    this._saveUsers(users);
    this._saveProducts(products);
    this._saveOrders([]);
    this._saveNotifications([]);
    localStorage.setItem(this.KEYS.SEEDED, 'true');
  },

  /**
   * Sync new farmers added to FARMERS_DATA without wiping existing data.
   * Adds any farmer from the JSON not already in the users array.
   */
  _syncFarmersFromData() {
    if (typeof FARMERS_DATA === 'undefined' || !FARMERS_DATA.farmers) return;
    const users = this.getUsers();
    const existingIds = new Set(users.map(u => u.id));
    let added = 0;
    for (const f of FARMERS_DATA.farmers) {
      if (!existingIds.has(f.id)) {
        users.push({
          id: f.id, name: f.name, phone: f.phone, role: 'farmer',
          location: f.location, specialties: f.specialties || [],
          farmType: f.farmType || 'backyard', rating: f.rating || 4.5,
          emoji: f.emoji || '🌿', available: f.available !== false,
          source: 'json', createdAt: Date.now()
        });
        added++;
      }
    }
    if (added > 0) this._saveUsers(users);
  }
};

// Seed / sync on script load
Store.seed();
