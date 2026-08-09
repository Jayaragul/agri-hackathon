/**
 * Mirrors `server/src/services/marketDemand.ts`'s `DemandTier` — same hand-mirrored-across-the-
 * boundary convention already used for `FarmerContextSummary` between `ephemeralToken.ts` and
 * `cropDoctorConfig.ts` (no shared module between the frontend and `server/`).
 */
export type DemandTier = "no-data" | "low" | "medium" | "high";
