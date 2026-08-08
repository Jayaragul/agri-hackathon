/**
 * Retry policy for the AI harness: *whether* to try again, and *how long* to wait.
 *
 * Both functions are pure and total. `computeBackoffMs` takes an injectable jitter source so
 * tests can pin the exact delay instead of asserting on a range.
 */

import type { AiHarnessError } from "../contracts/aiTypes";

/** Base delay for the exponential schedule, in ms. */
export const DEFAULT_BACKOFF_BASE_MS = 300;

/** Hard ceiling on any single backoff, in ms. A farmer will not wait longer than this. */
export const MAX_BACKOFF_MS = 8_000;

/**
 * True when trying the same call again could plausibly succeed.
 *
 * Retryable: `network` (connection reset / fetch failure / 5xx), `rate-limit` (429 — the
 * backoff is exactly the point), `timeout`.
 * Not retryable: `auth` (a bad key stays bad) and `validation` (a schema mismatch is repaired
 * by re-prompting, which the harness handles separately — never by a blind retry).
 * `unknown` is conservatively **not** retried unless the HTTP status says otherwise
 * (5xx, 408 Request Timeout, 429 Too Many Requests).
 */
export function isRetryable(err: AiHarnessError): boolean {
  if (!err || typeof err !== "object") return false;

  const kind = (err as { kind?: unknown }).kind;
  if (kind === "auth" || kind === "validation") return false;
  if (kind === "network" || kind === "rate-limit" || kind === "timeout") return true;

  const status = (err as { status?: unknown }).status;
  if (typeof status === "number" && Number.isFinite(status)) {
    if (status === 408 || status === 429) return true;
    if (status >= 500 && status <= 599) return true;
  }
  return false;
}

/**
 * Full-jitter exponential backoff: `jitter() * min(MAX_BACKOFF_MS, baseMs * 2^attempt)`.
 *
 * Full jitter (rather than a fixed delay plus noise) is what actually prevents a thundering
 * herd when several harness calls fail at once on a flaky rural connection.
 *
 * @param attempt Zero-based retry index. `0` is the delay before the first retry.
 * @param baseMs Base delay; defaults to {@link DEFAULT_BACKOFF_BASE_MS}. Invalid values fall back.
 * @param jitter Returns a factor in `[0, 1]`; defaults to `Math.random`. Inject `() => 1` for a
 *   deterministic worst case or `() => 0` to make retries instant in tests.
 * @returns A non-negative integer number of milliseconds, never above {@link MAX_BACKOFF_MS}.
 */
export function computeBackoffMs(
  attempt: number,
  baseMs: number = DEFAULT_BACKOFF_BASE_MS,
  jitter: () => number = Math.random
): number {
  const safeBase =
    typeof baseMs === "number" && Number.isFinite(baseMs) && baseMs > 0
      ? baseMs
      : DEFAULT_BACKOFF_BASE_MS;

  const safeAttempt =
    typeof attempt === "number" && Number.isFinite(attempt) && attempt > 0
      ? Math.floor(attempt)
      : 0;

  // Cap the exponent before multiplying so `2 ** attempt` can never reach Infinity.
  const boundedExponent = Math.min(safeAttempt, 32);
  const ceiling = Math.min(MAX_BACKOFF_MS, safeBase * Math.pow(2, boundedExponent));

  let factor: number;
  try {
    factor = jitter();
  } catch {
    factor = 1;
  }
  if (typeof factor !== "number" || !Number.isFinite(factor)) factor = 1;
  factor = Math.min(1, Math.max(0, factor));

  const delay = Math.round(ceiling * factor);
  return delay < 0 ? 0 : delay;
}
