/**
 * Zod-validated shape for the simulated "Community Pest Watch" network — 30 fake nearby farmer
 * profiles (never real people) used to demo proximity + same-crop pest alerting in the Digital
 * Twin feature. See `services/communityNetworkService.ts` for how this is generated and persisted.
 *
 * Deliberately its own copy, not imported from `src/domain/digitalTwin/*`: the server and
 * frontend are separate TypeScript packages (own tsconfig/build), same reasoning
 * `marketplaceTypes.ts` already documents for not sharing types across that boundary.
 */

import { z } from "zod";

export const CommunityPestReportSchema = z.object({
  pestName: z.string().min(1).max(120),
  severity: z.enum(["low", "medium", "high"]),
  reportedAtIso: z.string().min(1),
});

export const SimulatedCommunityFarmerSchema = z.object({
  id: z.string().min(1),
  lat: z.number().finite(),
  lng: z.number().finite(),
  /** Matches `src/domain/digitalTwin/models.ts`'s `Field.cropId` scheme exactly (e.g. "maize", "cotton") — a plain id, not a display name, so the frontend can compare against a real field's crop with no string-matching fuzziness. */
  cropId: z.string().min(1).max(40),
  /** `null` = this simulated farmer has nothing active to report right now. */
  activePestReport: CommunityPestReportSchema.nullable(),
});

export type SimulatedCommunityFarmer = z.infer<typeof SimulatedCommunityFarmerSchema>;

export const CommunityNetworkSchema = z.object({
  generatedAtIso: z.string().min(1),
  farmers: z.array(SimulatedCommunityFarmerSchema),
});

export type CommunityNetwork = z.infer<typeof CommunityNetworkSchema>;

/** GCS archive path for the one-time-generated seed — see `fileStore.ts#createMarketplaceArchiveBackend`, reused here under a different prefix rather than a second bucket concept. */
export const COMMUNITY_NETWORK_ARCHIVE_PATH = "community/simulated-farmers-v1.json";

export const COMMUNITY_FARMER_COUNT = 30;
