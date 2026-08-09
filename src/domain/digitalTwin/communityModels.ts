// Types for the simulated "Community Pest Watch" network — 30 fake nearby farmer profiles
// fetched from the server (`services/community/communityClient.ts`) and matched against real
// Digital Twin branch crops by `engine/communityPestAlerts.ts`. Mirrors
// `server/src/storage/communityTypes.ts` — kept as a separate copy since frontend and server are
// distinct TypeScript packages, same as every other cross-boundary shape in this app.

export interface CommunityPestReport {
  pestName: string;
  severity: "low" | "medium" | "high";
  reportedAtIso: string;
}

/** One simulated nearby farmer. Never a real person — see the UI copy in `CommunityAlerts.tsx` for how this is disclosed. */
export interface SimulatedCommunityFarmer {
  id: string;
  lat: number;
  lng: number;
  /** Matches `Field.cropId` in `domain/digitalTwin/models.ts` exactly (e.g. "maize"). */
  cropId: string;
  activePestReport: CommunityPestReport | null;
}

export interface CommunityNetwork {
  generatedAtIso: string;
  farmers: SimulatedCommunityFarmer[];
}
