/**
 * Geo — geolocation utilities and Haversine distance calculation
 */
const Geo = {

  EARTH_RADIUS_KM: 6371,

  toRad(deg) {
    return deg * Math.PI / 180;
  },

  /**
   * Haversine formula — returns great-circle distance in km
   * @param {Object} loc1 {lat, lng}
   * @param {Object} loc2 {lat, lng}
   * @returns {number} distance in km
   */
  haversineDistance(loc1, loc2) {
    const dLat = this.toRad(loc2.lat - loc1.lat);
    const dLng = this.toRad(loc2.lng - loc1.lng);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(loc1.lat)) * Math.cos(this.toRad(loc2.lat)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return this.EARTH_RADIUS_KM * c;
  },

  /**
   * Returns a human-readable distance string
   * @param {number} km
   * @returns {string}
   */
  formatDistance(km) {
    if (km < 0.1) return `${Math.round(km * 1000)} m`;
    if (km < 1)   return `${(km * 1000).toFixed(0)} m`;
    return `${km.toFixed(1)} km`;
  },

  /**
   * Gets current browser geolocation
   * @returns {Promise<{lat, lng, label}>}
   */
  getCurrentLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported by this browser'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: 'Current Location'
        }),
        err => reject(err),
        { timeout: 10000, enableHighAccuracy: true, maximumAge: 60000 }
      );
    });
  },

  /**
   * Finds farmers within `radiusKm` of `consumerLoc` from a list of farmer objects.
   * Each farmer must have a `location` property with {lat, lng}.
   * Returns sorted array (nearest first) with `distance` field added.
   *
   * @param {{lat, lng}} consumerLoc
   * @param {Array} farmers   Array of user objects with .location
   * @param {number} radiusKm Default 3
   * @returns {Array}
   */
  findFarmersWithin(consumerLoc, farmers, radiusKm = 3) {
    return farmers
      .map(farmer => ({
        ...farmer,
        distance: this.haversineDistance(consumerLoc, farmer.location)
      }))
      .filter(farmer => farmer.distance <= radiusKm)
      .sort((a, b) => a.distance - b.distance);
  },

  /**
   * Bearing from loc1 to loc2 in degrees (0 = North, 90 = East, etc.)
   */
  bearing(loc1, loc2) {
    const dLng = this.toRad(loc2.lng - loc1.lng);
    const lat1 = this.toRad(loc1.lat);
    const lat2 = this.toRad(loc2.lat);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
  },

  /**
   * Convert bearing to cardinal direction label
   */
  cardinalDirection(deg) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(deg / 45) % 8];
  }
};
