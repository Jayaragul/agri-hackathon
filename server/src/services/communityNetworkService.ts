/**
 * Generates and persists the simulated "Community Pest Watch" network — 30 fake nearby farmer
 * profiles scattered around Coimbatore, each growing one crop and roughly a quarter of them
 * currently "reporting" an active pest matching that crop. This is an explicitly-labeled DEMO
 * dataset (see the UI copy in `features/digital-twin/CommunityAlerts.tsx`) standing in for what
 * would, in a real deployment, be actual anonymized farmer reports — never real people, never
 * real reports.
 *
 * Generated ONCE and persisted to the GCS archive bucket (see `storage/fileStore.ts`'s
 * `createMarketplaceArchiveBackend` — reused here under a different prefix, not a second bucket
 * concept) so every server instance and every restart serves the SAME 30 farmers, exactly like a
 * real "30 users in the bucket" would behave. Falls back to an in-memory-only generation when no
 * archive backend is configured (`AGRIDB_BUCKET_NAME`/`GCS_BUCKET_NAME` both unset) — the feature
 * still works, it just regenerates (deterministically, same seed) on every server restart instead
 * of persisting.
 */

import type { FileBackend } from "../storage/fileStore";
import {
  CommunityNetworkSchema,
  COMMUNITY_FARMER_COUNT,
  COMMUNITY_NETWORK_ARCHIVE_PATH,
  type CommunityNetwork,
  type SimulatedCommunityFarmer,
} from "../storage/communityTypes";

// Fixed reference point — same Coimbatore city centre `DistrictMap.tsx` measures every real
// branch's distance/bearing from, so the simulated network sits in the same real-world area.
const CITY = { lat: 11.0168, lng: 76.9558 };
const SCATTER_RADIUS_KM = 22;
const KM_PER_DEG_LAT = 110.574;

// One representative pest per crop — illustrative for this simulation, not the verified
// Crop Doctor / Pest Defense dataset (`src/data/sample/pests.ts`), which stays the only source of
// truth an AI tool is ever allowed to resolve a real diagnosis against. Crop ids match
// `src/domain/digitalTwin/models.ts`'s scheme exactly.
const CROP_PESTS: Array<{ cropId: string; pestName: string }> = [
  { cropId: "sugarcane", pestName: "Early shoot borer" },
  { cropId: "rice", pestName: "Brown planthopper" },
  { cropId: "coconut", pestName: "Rhinoceros beetle" },
  { cropId: "cotton", pestName: "Pink bollworm" },
  { cropId: "maize", pestName: "Fall armyworm" },
  { cropId: "groundnut", pestName: "Leaf miner" },
  { cropId: "turmeric", pestName: "Rhizome rot" },
  { cropId: "banana", pestName: "Bunchy top virus" },
  { cropId: "onion", pestName: "Thrips" },
  { cropId: "tomato", pestName: "Fruit borer" },
  { cropId: "redgram", pestName: "Pod borer" },
];

const SEVERITIES: Array<"low" | "medium" | "high"> = ["low", "medium", "high"];

/** Deterministic PRNG (mulberry32) — same seed always produces the same 30 farmers, so a fresh in-memory fallback (no bucket configured) still looks identical to what would have been persisted. */
function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function generateNetwork(now: () => number): CommunityNetwork {
  const rand = mulberry32(20260809); // fixed seed — see module doc comment
  const kmPerDegLng = 111.32 * Math.cos((CITY.lat * Math.PI) / 180);

  const farmers: SimulatedCommunityFarmer[] = [];
  for (let i = 0; i < COMMUNITY_FARMER_COUNT; i++) {
    // Uniform-in-disk sampling (sqrt on the radius fraction), not uniform-in-square, so farmers
    // don't visually cluster near the city centre.
    const angle = rand() * 2 * Math.PI;
    const distKm = Math.sqrt(rand()) * SCATTER_RADIUS_KM;
    const dLat = ((distKm * Math.cos(angle)) / KM_PER_DEG_LAT);
    const dLng = distKm * Math.sin(angle) / kmPerDegLng;

    const cropPick = CROP_PESTS[Math.floor(rand() * CROP_PESTS.length)];
    const hasActiveReport = rand() < 0.28;

    farmers.push({
      id: `sim-farmer-${i + 1}`,
      lat: CITY.lat + dLat,
      lng: CITY.lng + dLng,
      cropId: cropPick.cropId,
      activePestReport: hasActiveReport
        ? {
            pestName: cropPick.pestName,
            severity: SEVERITIES[Math.floor(rand() * SEVERITIES.length)],
            reportedAtIso: new Date(now() - Math.floor(rand() * 5) * 24 * 60 * 60 * 1000).toISOString(),
          }
        : null,
    });
  }

  return { generatedAtIso: new Date(now()).toISOString(), farmers };
}

let cached: CommunityNetwork | null = null;

/**
 * Returns the community network, generating + persisting it on first call. Idempotent across
 * restarts when an archive backend is configured: a later process reads the same bucket object
 * instead of regenerating (matters if the seed or crop/pest table ever changes — the FIRST
 * deployment's snapshot keeps being served until the archive path is bumped, same "each document
 * IS the permanent record" posture `marketplaceTypes.ts` documents for the marketplace archive).
 */
export async function getCommunityNetwork(archive: FileBackend): Promise<CommunityNetwork> {
  if (cached) return cached;

  const existing = await archive.readFile(COMMUNITY_NETWORK_ARCHIVE_PATH);
  if (existing) {
    try {
      const parsed = CommunityNetworkSchema.parse(JSON.parse(existing.toString("utf-8")));
      cached = parsed;
      return parsed;
    } catch (err) {
      console.warn("[communityNetworkService] Stored network failed validation, regenerating:", err instanceof Error ? err.message : String(err));
    }
  }

  const network = generateNetwork(Date.now);
  cached = network;
  try {
    await archive.writeFile(COMMUNITY_NETWORK_ARCHIVE_PATH, Buffer.from(JSON.stringify(network, null, 2)), "application/json");
  } catch (err) {
    console.warn("[communityNetworkService] Could not persist generated network (continuing in-memory):", err instanceof Error ? err.message : String(err));
  }
  return network;
}

/** Test-only: force the next call to regenerate rather than reuse the in-process cache. */
export function resetCommunityNetworkCache(): void {
  cached = null;
}
