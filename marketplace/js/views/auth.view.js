/**
 * AuthView — Welcome, role selection, login, register screens
 */
const AuthView = {

  _selectedRole: null,
  _gpsLocation: null,

  show() {
    const content = document.getElementById('app-content');
    content.innerHTML = `
      <div class="auth-container">

        <!-- Welcome Hero -->
        <div class="auth-welcome">
          <div class="auth-logo">🌿</div>
          <h1 class="auth-title">FarmConnect</h1>
          <p class="auth-tagline">Fresh produce from farmers within 3 km — in real time</p>
        </div>

        <!-- Auth Card (slides up) -->
        <div class="auth-card">

          <!-- Step 1: Role Selection -->
          <div id="auth-role-step">
            <p class="role-prompt">I want to...</p>
            <div class="role-cards">
              <div class="role-card" id="role-consumer" onclick="AuthView._selectRole('consumer')">
                <span class="role-icon">🛒</span>
                <div class="role-title">Buy Produce</div>
                <div class="role-desc">Find fresh food from nearby farmers</div>
              </div>
              <div class="role-card" id="role-farmer" onclick="AuthView._selectRole('farmer')">
                <span class="role-icon">🌾</span>
                <div class="role-title">Sell Produce</div>
                <div class="role-desc">Connect with consumers in your area</div>
              </div>
            </div>
          </div>

          <!-- Step 2: Login / Register Form -->
          <div id="auth-form-step" class="hidden">
            <button class="back-btn" onclick="AuthView._goBack()">← Back</button>

            <!-- Tab switcher -->
            <div class="auth-tabs">
              <button class="auth-tab active" id="tab-login"    onclick="AuthView._showTab('login')">Login</button>
              <button class="auth-tab"         id="tab-register" onclick="AuthView._showTab('register')">Register</button>
            </div>

            <!-- Login Form -->
            <form id="login-form" class="auth-form" onsubmit="AuthView._handleLogin(event)">
              <div class="form-group">
                <label for="login-phone">Phone Number</label>
                <input class="form-control" type="tel" id="login-phone" placeholder="e.g. 9876543210" maxlength="10" required>
              </div>
              <button type="submit" class="btn btn-primary btn-full" id="login-btn">Login →</button>
              <div id="demo-hint" class="demo-hint" style="margin-top:16px"></div>
            </form>

            <!-- Register Form -->
            <form id="register-form" class="auth-form hidden" onsubmit="AuthView._handleRegister(event)">
              <div class="form-group">
                <label for="reg-name">Full Name</label>
                <input class="form-control" type="text" id="reg-name" placeholder="Your full name" required>
              </div>
              <div class="form-group">
                <label for="reg-phone">Phone Number</label>
                <input class="form-control" type="tel" id="reg-phone" placeholder="10-digit number" maxlength="10" required>
              </div>
              <div class="form-group relative">
                <label for="reg-location">Your Area / Neighbourhood</label>
                <input class="form-control" type="text" id="reg-location" placeholder="e.g. Indiranagar, Bengaluru" required>
                <button type="button" class="use-gps-btn" onclick="AuthView._useGPS()">📍 Use my GPS location</button>
              </div>
              <button type="submit" class="btn btn-primary btn-full">Create Account →</button>
            </form>
          </div>

        </div>
      </div>
    `;

    content.classList.add('fade-in');
  },

  _selectRole(role) {
    this._selectedRole = role;
    this._gpsLocation = null;

    document.getElementById('auth-role-step').classList.add('hidden');
    const formStep = document.getElementById('auth-form-step');
    formStep.classList.remove('hidden');
    formStep.classList.add('slide-up');

    // Show relevant demo credentials hint
    const hint = document.getElementById('demo-hint');
    if (hint) {
      if (role === 'consumer') {
        hint.innerHTML = `<strong>Demo account:</strong> <code>9876543210</code> (Priya Rajan)`;
      } else {
        hint.innerHTML = `<strong>Demo farmers:</strong><br>
          Ram Kumar: <code>9111111111</code><br>
          Muthu Selvam: <code>9222222222</code><br>
          Venkat Rao: <code>9444444444</code>`;
      }
    }
  },

  _goBack() {
    this._selectedRole = null;
    document.getElementById('auth-form-step').classList.add('hidden');
    document.getElementById('auth-role-step').classList.remove('hidden');
  },

  _showTab(tab) {
    const showLogin = tab === 'login';
    document.getElementById('login-form').classList.toggle('hidden', !showLogin);
    document.getElementById('register-form').classList.toggle('hidden', showLogin);
    document.getElementById('tab-login').classList.toggle('active', showLogin);
    document.getElementById('tab-register').classList.toggle('active', !showLogin);
  },

  _handleLogin(e) {
    e.preventDefault();
    const phone = document.getElementById('login-phone').value.trim();
    const result = Auth.login(phone, this._selectedRole);

    if (!result.success) {
      Toast.error(result.message);
      return;
    }

    Toast.success(`Welcome back, ${result.user.name}! 🌿`);
    setTimeout(() => App.showMainApp(result.user), 600);
  },

  _handleRegister(e) {
    e.preventDefault();
    const name     = document.getElementById('reg-name').value.trim();
    const phone    = document.getElementById('reg-phone').value.trim();
    const locLabel = document.getElementById('reg-location').value.trim();

    const location = this._gpsLocation
      ? { ...this._gpsLocation, label: locLabel || this._gpsLocation.label }
      : { lat: 12.9716, lng: 77.5946, label: locLabel }; // default to Bengaluru center

    const result = Auth.register({ name, phone, role: this._selectedRole, location });

    if (!result.success) {
      Toast.error(result.message);
      return;
    }

    Toast.success(`Welcome to FarmConnect, ${name}! 🌿`);
    setTimeout(() => App.showMainApp(result.user), 600);
  },

  _useGPS() {
    Toast.info('Detecting your location...');
    Geo.getCurrentLocation()
      .then(loc => {
        this._gpsLocation = loc;
        document.getElementById('reg-location').value = 'My GPS Location';
        Toast.success('Location captured! 📍');
      })
      .catch(() => {
        Toast.error('GPS unavailable. Please type your location manually.');
      });
  }
};
