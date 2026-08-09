/**
 * Community Pest Watch routes, mounted under `/api` by `server/src/index.ts`.
 *
 * `GET /api/community/network` is the only endpoint: returns the 30 simulated nearby farmers
 * (see `services/communityNetworkService.ts`) that `engine/communityPestAlerts.ts` on the
 * frontend matches against each real Digital Twin branch's crops to build proximity alerts.
 */
import { Router, type Request, type Response } from "express";
import type { FileBackend } from "../storage/fileStore";
import { getCommunityNetwork } from "../services/communityNetworkService";

export function createCommunityRoutes(archive: FileBackend): Router {
  const router = Router();

  router.get("/community/network", async (_req: Request, res: Response) => {
    try {
      const network = await getCommunityNetwork(archive);
      return res.status(200).json(network);
    } catch (err) {
      console.error("[communityRoutes] Could not build community network:", err instanceof Error ? err.message : String(err));
      return res.status(503).json({ error: "community_network_unavailable" });
    }
  });

  return router;
}
