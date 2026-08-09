/**
 * Frontend client for `server/src/routes/communityRoutes.ts`'s single endpoint — fetches the
 * simulated "Community Pest Watch" network. Never throws: a network failure or unconfigured
 * backend resolves to an empty network, same silently-degrading posture as
 * `services/marketplace/marketplaceClient.ts` and `services/weather/weatherClient.ts` — the
 * Digital Twin screen works identically without it, just without proximity pest alerts.
 */
import type { CommunityNetwork } from "../../domain/digitalTwin/communityModels";

function readApiBase(): string {
  try {
    const raw = import.meta.env.VITE_API_BASE_URL;
    return typeof raw === "string" ? raw.trim().replace(/\/$/, "") : "";
  } catch {
    return "";
  }
}

const EMPTY_NETWORK: CommunityNetwork = { generatedAtIso: new Date(0).toISOString(), farmers: [] };

export async function getCommunityNetwork(): Promise<CommunityNetwork> {
  try {
    const response = await fetch(`${readApiBase()}/api/community/network`);
    if (!response.ok) return EMPTY_NETWORK;
    const body = (await response.json()) as Partial<CommunityNetwork>;
    return {
      generatedAtIso: body.generatedAtIso ?? EMPTY_NETWORK.generatedAtIso,
      farmers: Array.isArray(body.farmers) ? body.farmers : [],
    };
  } catch {
    return EMPTY_NETWORK;
  }
}
