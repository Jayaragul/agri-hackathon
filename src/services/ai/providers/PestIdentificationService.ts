/**
 * Matches a crop photo against the verified pest dataset.
 *
 * The safety design is that the model only ever returns an IDENTIFIER. Everything a farmer
 * acts on - symptoms, biological control, chemical control, economic threshold - is read from
 * `src/data/sample/pests.ts` by `resolvePest` and rendered verbatim. The model is never asked
 * for treatment advice and its answer is never used as treatment advice.
 *
 * Two enforcement layers sit under that:
 *  - The prompt supplies only the candidates for the farmer's crop, so "dead heart" (a symptom
 *    shared by four pests across four crops) cannot be resolved to the wrong crop's pest.
 *  - `identify()` re-checks the returned id against the candidate list and discards anything
 *    outside it. A hallucinated pest name therefore cannot reach the screen even if the model
 *    ignores its instructions.
 *
 * Note that some dataset entries deliberately carry NO `chemicalControl` - the tomato leaf
 * curl virus has no chemical cure - so consumers must treat that field as optional and must
 * never substitute one.
 */

import type { Crop, PestRisk } from "../../../domain/models/models";
import type { AiOutcome, InlineImage } from "../contracts/aiTypes";
import type { PestIdentification } from "../contracts/aiSchemas";
import type { AiHarness } from "../runtime/AiHarness";
import { samplePests } from "../../../data/sample/pests";
import { createIdentifyPestTask, createNoPestMatch } from "../tasks/identifyPestTask";

/**
 * A harness outcome plus the dataset record the match resolved to.
 *
 * `matchedPest` is the ONLY sanctioned source of guidance text. Read symptoms and controls
 * from it, never from `data.reasoning` or `data.observedSymptoms`.
 */
export interface PestIdentificationOutcome extends AiOutcome<PestIdentification> {
  matchedPest: PestRisk | null;
}

/** Harness-backed pest photo matcher. */
export class PestIdentificationService {
  private readonly harness: AiHarness;
  private readonly pests: PestRisk[];
  private readonly task = createIdentifyPestTask();

  constructor(harness: AiHarness, pests: PestRisk[] = samplePests) {
    this.harness = harness;
    this.pests = Array.isArray(pests) ? pests : [];
  }

  /** The closed candidate set for a crop: every verified pest record whose `cropId` matches. */
  public getCandidates(cropId: string): PestRisk[] {
    const target = typeof cropId === "string" ? cropId : "";
    return this.pests.filter((pest) => pest?.cropId === target);
  }

  /** Look a dataset record up by id. Returns null for an unknown id - it never throws. */
  public resolvePest(pestId: string | null): PestRisk | null {
    if (typeof pestId !== "string" || pestId.length === 0) return null;
    return this.pests.find((pest) => pest?.id === pestId) ?? null;
  }

  /**
   * Match a photo against the crop's pest list.
   *
   * Always resolves. When the crop has no verified pest records at all, no model call is made
   * - there is nothing to classify into, so guessing is the only thing a call could add.
   */
  public async identify(
    image: InlineImage,
    crop: Crop
  ): Promise<PestIdentificationOutcome> {
    const candidates = this.getCandidates(crop?.id ?? "");

    if (candidates.length === 0) {
      return {
        data: createNoPestMatch(
          "This app holds no verified pest records for this crop, so the photo was not matched."
        ),
        matchedPest: null,
        source: "local",
        latencyMs: 0,
        degraded: true,
        validationRepaired: false,
        notes: ["No verified pest records exist for this crop; no model call was made."],
      };
    }

    let outcome: AiOutcome<PestIdentification>;
    try {
      outcome = await this.harness.run(this.task, { image, crop, candidates });
    } catch {
      // `AiHarness.run` is contractually non-rejecting; this guards a broken injected double.
      outcome = {
        data: createNoPestMatch(
          "Photo matching is unavailable right now, so no pest was identified."
        ),
        source: "local",
        latencyMs: 0,
        degraded: true,
        validationRepaired: false,
        notes: ["AI harness was unavailable; the photo was not matched."],
      };
    }

    return this.enforceClosedSet(outcome, candidates);
  }

  /**
   * Discard any match that is not in the supplied candidate list.
   *
   * This is the hard guarantee behind the feature: a pest name can only reach the farmer if it
   * already exists in the vetted dataset for their crop. `matchedPestName` is also re-read
   * from the dataset rather than trusted from the response, so a correct id with a reworded
   * name still displays the dataset's wording.
   */
  private enforceClosedSet(
    outcome: AiOutcome<PestIdentification>,
    candidates: PestRisk[]
  ): PestIdentificationOutcome {
    const data = outcome.data;
    const notes = Array.isArray(outcome.notes) ? outcome.notes.slice() : [];
    const claimedId = data?.matchedKnownPestId ?? null;

    const allowed =
      claimedId !== null
        ? candidates.find((pest) => pest?.id === claimedId) ?? null
        : null;

    if (claimedId !== null && allowed === null) {
      notes.push(
        `Rejected pest id "${claimedId}" because it is not in the verified list for this crop.`
      );
      return {
        ...outcome,
        data: {
          ...data,
          matchedKnownPestId: null,
          matchedPestName: null,
          confidence: "low",
        },
        matchedPest: null,
        notes,
      };
    }

    if (allowed === null) {
      return { ...outcome, data: { ...data, matchedPestName: null }, matchedPest: null, notes };
    }

    // A non-plant photo must never carry a match, whatever id came back with it.
    if (data.imageIsPlant === false) {
      notes.push("Match discarded because the photo was not identified as a plant.");
      return {
        ...outcome,
        data: {
          ...data,
          matchedKnownPestId: null,
          matchedPestName: null,
          confidence: "low",
        },
        matchedPest: null,
        notes,
      };
    }

    return {
      ...outcome,
      data: { ...data, matchedPestName: allowed.pestName },
      matchedPest: allowed,
      notes,
    };
  }
}
