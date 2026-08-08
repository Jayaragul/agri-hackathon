/**
 * Tiny, dependency-light formatting helpers shared by the four prompt builders.
 *
 * WHY THIS EXISTS: the engine emits raw unrounded floats, and two of its numeric paths can
 * produce `NaN` (a non-numeric pH read off a soil card) or negative values (a negative NPK
 * input). `JSON.stringify` turns `NaN` into `null`, which reads to a model as "no data" and
 * invites a hallucinated replacement. Every number that reaches a prompt therefore goes
 * through `formatNumber`, which renders unusable values as the explicit word "unknown".
 *
 * These helpers only FORMAT. They never round a value that is then fed back into the engine,
 * and they never alter a stored number — the deterministic layer remains the sole owner of
 * every score, cost and threshold.
 */

import { MONTH_NAMES } from "../../../domain/constants/constants";

/** Rendered in place of any number that is missing, NaN, or infinite. */
export const UNKNOWN_NUMBER = "unknown";

/**
 * Format a number for display inside a prompt. Non-finite input (NaN/Infinity), and anything
 * that is not a number at all, becomes `"unknown"` rather than a misleading `0` or `null`.
 */
export function formatNumber(value: unknown, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return UNKNOWN_NUMBER;
  return value.toFixed(digits);
}

/** Same contract as `formatNumber`, rendered without decimals (scores, point totals). */
export function formatInteger(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return UNKNOWN_NUMBER;
  return String(Math.round(value));
}

/**
 * Format a `DecisionTraceEntry.inputValue` / `requiredValue`, which the engine types as
 * `string | number`. Numbers go through the finite guard; strings are trimmed; empty or
 * missing values become "unknown" so the model is never handed a blank to fill in.
 */
export function formatTraceValue(value: unknown): string {
  if (typeof value === "number") return formatNumber(value, 1);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : UNKNOWN_NUMBER;
  }
  return UNKNOWN_NUMBER;
}

/**
 * Human month name for a 1-based month.
 *
 * `MONTH_NAMES` is a 0-indexed array while `FarmProfile.currentMonth` is 1-based, so the
 * naive `MONTH_NAMES[month]` lookup is off by one. This helper is the corrected accessor;
 * it does not modify the constant.
 */
export function formatMonth(month: unknown): string {
  if (typeof month !== "number" || !Number.isFinite(month)) return UNKNOWN_NUMBER;
  const index = Math.round(month) - 1;
  if (index < 0 || index >= MONTH_NAMES.length) return UNKNOWN_NUMBER;
  return MONTH_NAMES[index];
}

/** Join a string list for prompt display; empty lists read as "none" rather than "". */
export function formatList(values: unknown, empty = "none recorded"): string {
  if (!Array.isArray(values) || values.length === 0) return empty;
  const cleaned = values
    .map((v) => (typeof v === "string" ? v.trim() : String(v)))
    .filter((v) => v.length > 0);
  return cleaned.length > 0 ? cleaned.join(", ") : empty;
}

/**
 * Collapse whitespace and strip characters that would let dataset text break out of the
 * plain-text prompt framing. Purely defensive: dataset strings are trusted, but user-derived
 * strings (region, soil type) are not.
 */
export function sanitiseInline(value: unknown, maxLength = 200): string {
  if (typeof value !== "string") return "";
  const collapsed = value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return collapsed.length > maxLength ? collapsed.slice(0, maxLength) : collapsed;
}

/**
 * Deterministic 32-bit string hash (djb2), rendered base36. Used only to build compact,
 * stable cache keys from large inputs such as a base64 image payload.
 */
export function stableHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
