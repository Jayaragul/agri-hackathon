/**
 * Loads the Google Maps JavaScript API exactly once (script-tag injection, cached promise) —
 * used by `features/digital-twin/LiveMap.tsx`. Deliberately hand-rolled instead of a wrapper
 * library: it's a handful of lines, and this app already avoids adding a dependency where a
 * short, auditable function does the same job (see `services/report/pdfExport.ts`'s comment on
 * SVG charts for the same reasoning).
 *
 * Resolves to `null` — never throws — when `VITE_GOOGLE_MAPS_API_KEY` is unset or the script
 * fails to load (network issue, invalid/restricted key, offline). `LiveMap.tsx` treats `null` as
 * "fall back to the existing DistrictMap SVG," the same graceful-degradation posture every other
 * optional integration in this app follows.
 */

declare global {
  interface Window {
    google?: typeof google;
  }
}

let loadPromise: Promise<typeof google | null> | null = null;

function readApiKey(): string {
  try {
    const raw = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    return typeof raw === "string" ? raw.trim() : "";
  } catch {
    return "";
  }
}

/** Loads (or returns the already-loaded) Google Maps JS API. Safe to call from multiple components — the underlying script tag is only ever injected once. */
export function loadGoogleMaps(): Promise<typeof google | null> {
  if (loadPromise) return loadPromise;

  const apiKey = readApiKey();
  if (!apiKey) {
    loadPromise = Promise.resolve(null);
    return loadPromise;
  }

  if (window.google?.maps) {
    loadPromise = Promise.resolve(window.google);
    return loadPromise;
  }

  loadPromise = new Promise((resolve) => {
    const callbackName = "__thulirGoogleMapsLoaded";
    (window as unknown as Record<string, () => void>)[callbackName] = () => {
      resolve(window.google ?? null);
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=${callbackName}&v=weekly`;
    script.async = true;
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });

  return loadPromise;
}
