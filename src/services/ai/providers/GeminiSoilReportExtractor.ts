/**
 * Reads a photographed soil report into a `Partial<FarmProfile>`.
 *
 * Implements the pre-existing `SoilReportExtractor` interface from
 * `src/domain/models/models.ts`, which takes a browser `File` - so the base64 conversion the
 * Gemini `inlineData` part needs happens here.
 *
 * THIS IS THE ONLY PLACE AI OUTPUT FLOWS BACK INTO THE DETERMINISTIC ENGINE, so it is guarded
 * twice. The zod schema rejects out-of-range values on the way out of the harness, and
 * `toPartialProfile` below independently re-checks every number before it is allowed into a
 * `FarmProfile`: non-finite values (a `NaN` pH scores as a *good* factor in the engine and
 * poisons the total), negative values (which produce negative component scores), and
 * out-of-range values are all dropped rather than clamped. A dropped field simply stays
 * absent from the `Partial`, so the farmer's own entry is preserved.
 */

import type {
  FarmProfile,
  SoilReportExtractor,
} from "../../../domain/models/models";
import type { AiOutcome, InlineImage } from "../contracts/aiTypes";
import type { SoilReportExtraction } from "../contracts/aiSchemas";
import type { AiHarness } from "../runtime/AiHarness";
import {
  createExtractSoilReportTask,
  createEmptySoilExtraction,
} from "../tasks/extractSoilReportTask";

/** Field bounds mirrored from `SoilReportExtractionSchema` / `FarmProfileSchema`. */
const PH_MIN = 0;
const PH_MAX = 14;
const NUTRIENT_MIN = 0;
const NUTRIENT_MAX = 500;

/** Image/document types the multimodal endpoint reliably accepts. */
const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/** Accept a number only if it is finite and inside the allowed range. Never clamps. */
function acceptNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

/**
 * Convert a validated extraction into the `Partial<FarmProfile>` the store expects.
 *
 * Only fields that survive the range check are included. A rejected field is omitted entirely
 * rather than sent as `0`, because `0` is a legitimate nutrient reading and would silently
 * overwrite whatever the farmer typed.
 */
export function toPartialProfile(
  extraction: SoilReportExtraction
): Partial<FarmProfile> {
  const profile: Partial<FarmProfile> = {};
  if (!extraction || extraction.documentRecognised !== true) return profile;

  const ph = acceptNumber(extraction.ph, PH_MIN, PH_MAX);
  if (ph !== null) profile.ph = ph;

  const n = acceptNumber(extraction.nitrogenKgPerAcre, NUTRIENT_MIN, NUTRIENT_MAX);
  if (n !== null) profile.nitrogenKgPerAcre = n;

  const p = acceptNumber(extraction.phosphorusKgPerAcre, NUTRIENT_MIN, NUTRIENT_MAX);
  if (p !== null) profile.phosphorusKgPerAcre = p;

  const k = acceptNumber(extraction.potassiumKgPerAcre, NUTRIENT_MIN, NUTRIENT_MAX);
  if (k !== null) profile.potassiumKgPerAcre = k;

  return profile;
}

/**
 * Read a `File` into the bare base64 payload Gemini's `inlineData` part expects.
 *
 * The `data:<mime>;base64,` prefix that `readAsDataURL` produces MUST be stripped - leaving it
 * in makes the provider reject the part. `FileReader` is used rather than
 * `arrayBuffer()` + `btoa` because it avoids building a megabyte-long intermediate binary
 * string and is available in both the browser and jsdom.
 */
export function fileToInlineImage(file: File): Promise<InlineImage> {
  return new Promise<InlineImage>((resolve, reject) => {
    try {
      if (!file || file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
        reject(new Error("The selected file is empty or larger than 12 MB."));
        return;
      }
      const declaredType = typeof file?.type === "string" ? file.type : "";
      const mimeType =
        SUPPORTED_IMAGE_TYPES.indexOf(declaredType) !== -1 ? declaredType : "image/jpeg";

      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read the selected file."));
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string") {
          reject(new Error("Could not read the selected file."));
          return;
        }
        const comma = result.indexOf(",");
        const base64Data = comma >= 0 ? result.slice(comma + 1) : result;
        if (base64Data.length === 0) {
          reject(new Error("The selected file is empty."));
          return;
        }
        resolve({ mimeType, base64Data });
      };
      reader.readAsDataURL(file);
    } catch (err) {
      reject(err instanceof Error ? err : new Error("Could not read the selected file."));
    }
  });
}

/** Harness-backed soil report reader. */
export class GeminiSoilReportExtractor implements SoilReportExtractor {
  private readonly harness: AiHarness;
  private readonly task = createExtractSoilReportTask();

  constructor(harness: AiHarness) {
    this.harness = harness;
  }

  /**
   * The existing interface method. Resolves to whatever could be read safely - an empty object
   * when nothing could - and never rejects, so a bad photo cannot break the profile form.
   */
  public async extract(file: File): Promise<Partial<FarmProfile>> {
    const outcome = await this.extractDetailed(file);
    return toPartialProfile(outcome.data);
  }

  /**
   * Full outcome including `warnings` (unit conversions, unreadable fields),
   * `documentRecognised`, confidence, and harness provenance. The upload UI uses this so it
   * can tell the farmer *why* a field came back empty.
   */
  public async extractDetailed(
    file: File
  ): Promise<AiOutcome<SoilReportExtraction>> {
    let image: InlineImage;
    try {
      image = await fileToInlineImage(file);
    } catch {
      return {
        data: createEmptySoilExtraction(
          "The selected file could not be opened. Please try another photo, or enter your soil values by hand."
        ),
        source: "unavailable",
        latencyMs: 0,
        degraded: true,
        validationRepaired: false,
        notes: ["The uploaded file could not be read in the browser."],
      };
    }

    try {
      return await this.harness.run(this.task, { image });
    } catch {
      // `AiHarness.run` is contractually non-rejecting; this guards a broken injected double.
      return {
        data: createEmptySoilExtraction(
          "Automatic reading is unavailable right now. Please enter your soil test values by hand."
        ),
        source: "local",
        latencyMs: 0,
        degraded: true,
        validationRepaired: false,
        notes: ["AI harness was unavailable; no values were read from the image."],
      };
    }
  }
}
