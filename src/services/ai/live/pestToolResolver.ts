/**
 * Resolves the Crop Doctor's `reportPestObservation` tool call against the SAME verified,
 * closed candidate list used everywhere else pest guidance is given
 * (`services/ai/providers/PestIdentificationService.ts`'s `enforceClosedSet`). Live video is a
 * faster perception channel into this identical discipline, not a new, less-constrained one:
 * the model may only ever receive treatment text that already exists in `sample/pests.ts` for
 * THIS crop, keyed by an id it must have picked from the candidate list it was given at
 * connection time. An id outside that list resolves to "no match," never a guess.
 */
import type { PestRisk } from "../../../domain/models/models";

export interface PestObservationArgs {
  observedSymptoms?: unknown;
  matchedKnownPestId?: unknown;
  confidence?: unknown;
}

export interface PestToolResult {
  matched: boolean;
  pestName: string | null;
  biologicalControl: string | null;
  chemicalControl: string | null;
  economicThreshold: string | null;
  /** Instruction embedded in the tool response itself, reinforcing the "relay verbatim" rule at the one point the model is most likely to editorialise. */
  note: string;
}

export function resolvePestObservation(args: PestObservationArgs, candidates: PestRisk[]): PestToolResult {
  const claimedId = typeof args?.matchedKnownPestId === "string" ? args.matchedKnownPestId : null;
  const allowed = claimedId !== null ? candidates.find((pest) => pest?.id === claimedId) ?? null : null;

  if (claimedId !== null && allowed === null) {
    return {
      matched: false,
      pestName: null,
      biologicalControl: null,
      chemicalControl: null,
      economicThreshold: null,
      note: `The id "${claimedId}" is not in this crop's verified list. Tell the farmer this does not clearly match a known issue and suggest a local KVK extension officer — do not guess.`,
    };
  }

  if (allowed === null) {
    return {
      matched: false,
      pestName: null,
      biologicalControl: null,
      chemicalControl: null,
      economicThreshold: null,
      note: "No verified match. Ask the farmer for a clearer or closer view, or tell them plainly that nothing in the known list matches yet.",
    };
  }

  return {
    matched: true,
    pestName: allowed.pestName,
    biologicalControl: allowed.biologicalControl,
    chemicalControl: allowed.chemicalControl ?? null,
    economicThreshold: allowed.economicThreshold,
    note: "This is the verified guidance for the matched pest. Relay it faithfully in your own conversational words — never add a product name, dose, or step that is not written here.",
  };
}
