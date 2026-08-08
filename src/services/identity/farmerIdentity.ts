/**
 * The farmer's own name and freeform "declared situation," captured during onboarding/Audio Mode
 * and kept in `localStorage` — same "this browser, on this device" scope as
 * `services/session/sessionId.ts`, which this file deliberately mirrors. Every agent that
 * personalises a reply (Farm Advisor, Audio Mode, Crop Doctor) reads these through
 * `services/context/farmContext.ts`, never this module directly.
 */

const FARMER_ID_KEY = "krishi-mitra.farmer-id";

function randomUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to the manual generator below.
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let cachedFarmerId: string | null = null;

/**
 * A stable, `localStorage`-persisted per-device farmer id — deliberately separate from
 * `services/session/sessionId.ts`'s session id, which is meant to churn. This is what lets
 * mem0 memory (`services/memory/memoryClient.ts`) follow the SAME farmer across app reloads and
 * new sessions instead of starting over every time a fresh session id is minted. Same
 * fallback-on-failure discipline as `getSessionId()`: never throws, degrades to a per-load id
 * when `localStorage` is unavailable (private browsing, SSR).
 */
export function getFarmerId(): string {
  if (cachedFarmerId !== null) return cachedFarmerId;
  try {
    const existing = localStorage.getItem(FARMER_ID_KEY);
    if (existing && existing.length > 0) {
      cachedFarmerId = existing;
      return existing;
    }
    const created = randomUuid();
    localStorage.setItem(FARMER_ID_KEY, created);
    cachedFarmerId = created;
    return created;
  } catch {
    cachedFarmerId = randomUuid();
    return cachedFarmerId;
  }
}

const FARMER_NAME_KEY = "krishi-mitra.farmer-name";

let cachedName: string | null | undefined;

/** The farmer's name, or `null` if onboarding hasn't captured one yet. Never throws. */
export function getFarmerName(): string | null {
  if (cachedName !== undefined) return cachedName;
  try {
    const existing = localStorage.getItem(FARMER_NAME_KEY);
    cachedName = existing && existing.trim().length > 0 ? existing.trim() : null;
  } catch {
    cachedName = null;
  }
  return cachedName;
}

/** Persist the farmer's name. A blank name clears it, re-triggering onboarding on next load. */
export function setFarmerName(name: string): void {
  const trimmed = name.trim();
  cachedName = trimmed.length > 0 ? trimmed : null;
  try {
    if (cachedName) localStorage.setItem(FARMER_NAME_KEY, cachedName);
    else localStorage.removeItem(FARMER_NAME_KEY);
  } catch {
    // Best-effort only — the in-memory cache above still lets the current session work.
  }
}

const ONBOARDING_COMPLETE_KEY = "krishi-mitra.onboarding-complete";

let cachedOnboardingComplete: boolean | undefined;

/**
 * Whether the farmer has been through BOTH onboarding steps (name capture and mode choice).
 * Kept separate from `getFarmerName()` on purpose: capturing the name is what unlocks
 * personalisation everywhere, but `OnboardingGate` still has a mode-choice screen to show
 * afterward — gating the app shell on the name alone would unmount that screen the instant the
 * name is set, before the farmer ever sees it.
 */
export function isOnboardingComplete(): boolean {
  if (cachedOnboardingComplete !== undefined) return cachedOnboardingComplete;
  try {
    cachedOnboardingComplete = localStorage.getItem(ONBOARDING_COMPLETE_KEY) === "true";
  } catch {
    cachedOnboardingComplete = false;
  }
  return cachedOnboardingComplete;
}

export function markOnboardingComplete(): void {
  cachedOnboardingComplete = true;
  try {
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, "true");
  } catch {
    // Best-effort — the in-memory cache still prevents onboarding from reappearing this session.
  }
}

const DECLARED_SITUATION_KEY = "krishi-mitra.declared-situation";
const MAX_DECLARED_SITUATION_CHARS = 300;

let cachedDeclaredSituation: string | null | undefined;

/**
 * Whatever the farmer has volunteered about their own situation ("I grow groundnut on two acres
 * near Coimbatore") — captured opportunistically the first time they say anything substantial in
 * Audio Mode (see `useVoiceConversation.ts`), NOT extracted or structured, just relayed verbatim.
 *
 * This exists to close a real gap: `profile`/`selectedCrop` only get set by walking the farm
 * wizard, but Audio Mode is the app's default landing screen and most farmers may never open the
 * wizard at all. Without this, every Audio Mode answer stayed generic forever. This is
 * deliberately NOT treated as engine-verified fact (per [[krishi-mitra-ai-boundary]], only the
 * wizard's own recommendation engine gets to do that) — every prompt that uses it labels it
 * "farmer-reported, not verified," identically to how mem0 memories are already framed.
 */
export function getDeclaredSituation(): string | null {
  if (cachedDeclaredSituation !== undefined) return cachedDeclaredSituation;
  try {
    const existing = localStorage.getItem(DECLARED_SITUATION_KEY);
    cachedDeclaredSituation = existing && existing.trim().length > 0 ? existing.trim() : null;
  } catch {
    cachedDeclaredSituation = null;
  }
  return cachedDeclaredSituation;
}

export function setDeclaredSituation(text: string): void {
  const trimmed = text.trim().slice(0, MAX_DECLARED_SITUATION_CHARS);
  cachedDeclaredSituation = trimmed.length > 0 ? trimmed : null;
  try {
    if (cachedDeclaredSituation) localStorage.setItem(DECLARED_SITUATION_KEY, cachedDeclaredSituation);
    else localStorage.removeItem(DECLARED_SITUATION_KEY);
  } catch {
    // Best-effort only — the in-memory cache above still lets the current session work.
  }
}
