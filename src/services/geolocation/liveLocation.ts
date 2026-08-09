/**
 * Best-effort wrapper around the browser Geolocation API — used by
 * `features/digital-twin/LiveMap.tsx` to center the map on the farmer's actual position and drop
 * a "you are here" marker. Never throws and never blocks the caller waiting on a slow/denied
 * permission prompt past `TIMEOUT_MS`: resolves to `null` on denial, timeout, unsupported browser,
 * or any other failure, exactly like every other optional integration in this app degrades.
 */

export interface LiveLocation {
  lat: number;
  lng: number;
  /** Meters — from the browser's own accuracy estimate, shown to the farmer as an honest caveat rather than implying survey-grade precision. */
  accuracyM: number;
}

const TIMEOUT_MS = 8_000;

export function getLiveLocation(): Promise<LiveLocation | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        });
      },
      () => resolve(null), // Permission denied, position unavailable, or timeout — all the same "no location" outcome to the caller.
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: 60_000 }
    );
  });
}
