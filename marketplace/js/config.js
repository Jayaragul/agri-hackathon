/**
 * Config — where the Krishi Mitra backend lives, for the two-way sync bridge (bridge.js).
 *
 * FarmConnect is deployed as its own static site (no build step, no server of its own) — this
 * is the one file to edit when pointing it at a different Krishi Mitra deployment. Leave empty
 * to disable the bridge entirely; every FarmConnect feature already works standalone on
 * localStorage with no bridge configured, exactly as it did before this integration existed.
 */
const Config = {
  // Example: 'https://krishi-mitra.example.com'. Empty string disables cross-app sync.
  KRISHI_MITRA_API_BASE: '',

  bridgeEnabled() {
    return typeof this.KRISHI_MITRA_API_BASE === 'string' && this.KRISHI_MITRA_API_BASE.trim().length > 0;
  }
};
