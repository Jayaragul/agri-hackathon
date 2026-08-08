/**
 * A minimal, fully deterministic circuit breaker guarding outbound model calls.
 *
 * Why it exists: when the key is revoked or the network is down, every AI-backed screen would
 * otherwise pay the full timeout before falling back. After `threshold` consecutive failures the
 * breaker opens and the harness goes straight to its deterministic local fallback — instant,
 * correct, no spinner — until a cooldown has elapsed and a single probe can re-test the service.
 *
 * State machine:
 *   closed    --(`threshold` consecutive failures)-->  open
 *   open      --(`cooldownMs` elapsed per `now()`)-->  half-open   [probe allowed]
 *   half-open --(success)-->  closed  [counter reset]
 *   half-open --(failure)-->  open    [cooldown restarts from now()]
 *
 * `now()` is injectable and is the ONLY clock this class reads, so tests advance time by hand
 * rather than sleeping. Every method is total.
 */

export type BreakerState = "closed" | "open" | "half-open";

/** Fallback clock. Isolated so the injected `now()` is provably the only other time source. */
function defaultNow(): number {
  try {
    return Date.now();
  } catch {
    return 0;
  }
}

export class CircuitBreaker {
  /** Consecutive failures required to trip the breaker. Always >= 1. */
  private readonly threshold: number;
  /** How long `open` lasts before a probe is permitted. Always >= 0. */
  private readonly cooldownMs: number;
  /** Injected clock — the sole source of time in this class. */
  private readonly clock: () => number;

  /** Raw state; `refresh()` promotes `open` -> `half-open` when the cooldown has elapsed. */
  private current: BreakerState = "closed";
  /** Consecutive failures since the last success or reset. */
  private failures = 0;
  /** Timestamp of the transition into `open`; the cooldown is measured from here. */
  private openedAt = 0;

  /**
   * @param threshold Consecutive failures that trip the breaker. Values < 1 are clamped to 1.
   * @param cooldownMs Time the breaker stays open. Invalid/negative values are clamped to 0.
   * @param now Injectable clock. Defaults to `Date.now`. **Tests must inject this.**
   */
  constructor(threshold: number, cooldownMs: number, now?: () => number) {
    this.threshold =
      typeof threshold === "number" && Number.isFinite(threshold) && threshold >= 1
        ? Math.floor(threshold)
        : 1;
    this.cooldownMs =
      typeof cooldownMs === "number" && Number.isFinite(cooldownMs) && cooldownMs > 0
        ? cooldownMs
        : 0;
    this.clock = typeof now === "function" ? now : defaultNow;
  }

  /**
   * May the caller make a live request right now?
   *
   * `true` when closed, and `true` for the probe once an open breaker's cooldown has elapsed
   * (which also transitions it to `half-open`). Multiple probes are permitted while half-open —
   * the first result decides which way the breaker resolves.
   */
  canAttempt(): boolean {
    return this.refresh() !== "open";
  }

  /** A live call succeeded: close the breaker and forget the failure history. */
  recordSuccess(): void {
    this.current = "closed";
    this.failures = 0;
    this.openedAt = 0;
  }

  /**
   * A live call failed.
   *
   * While half-open, a single failure immediately re-opens the breaker and restarts the
   * cooldown. While closed, failures accumulate and trip the breaker at `threshold`.
   */
  recordFailure(): void {
    const state = this.refresh();

    if (state === "half-open") {
      this.failures = this.threshold;
      this.trip();
      return;
    }

    if (state === "open") {
      // Already open (a call raced past the gate) — keep the existing cooldown window.
      return;
    }

    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.trip();
    }
  }

  /**
   * Current state, with the time-based `open` -> `half-open` promotion applied, so reading
   * `state` after advancing the injected clock reports `half-open` without needing a
   * `canAttempt()` call first.
   */
  get state(): BreakerState {
    return this.refresh();
  }

  /** Force the breaker back to a pristine closed state. */
  reset(): void {
    this.current = "closed";
    this.failures = 0;
    this.openedAt = 0;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Enter `open` and start the cooldown from the current injected time. */
  private trip(): void {
    this.current = "open";
    this.openedAt = this.readNow();
  }

  /** Apply the elapsed-cooldown promotion, then report the effective state. */
  private refresh(): BreakerState {
    if (this.current === "open") {
      const elapsed = this.readNow() - this.openedAt;
      if (elapsed >= this.cooldownMs) {
        this.current = "half-open";
      }
    }
    return this.current;
  }

  /** Read the injected clock defensively — a throwing or non-numeric clock must not break us. */
  private readNow(): number {
    try {
      const value = this.clock();
      return typeof value === "number" && Number.isFinite(value) ? value : 0;
    } catch {
      return 0;
    }
  }
}
