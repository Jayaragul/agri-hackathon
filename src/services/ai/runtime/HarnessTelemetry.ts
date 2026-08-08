/**
 * In-memory, bounded telemetry log for the AI harness.
 *
 * Every `AiHarness.run()` produces exactly one record here, whatever the outcome — live answer,
 * cache replay, or deterministic fallback. That log is what powers the AI trace panel, which is
 * the project's honesty mechanism: a farmer (or a judge) can see which answers came from a model
 * and which came from the deterministic engine, and no answer can quietly pretend to be the
 * other.
 *
 * Deliberately synchronous, dependency-free, and bounded — it must never leak memory during a
 * long session and must never throw into the caller's control flow.
 */

import type { AiCallRecord } from "../contracts/aiTypes";

/** Default ring-buffer capacity. Comfortably more than a demo session produces. */
export const DEFAULT_TELEMETRY_LIMIT = 100;

export class HarnessTelemetry {
  /** Maximum retained records. Always >= 1. */
  private readonly limit: number;
  /** Ring buffer, oldest first. */
  private records: AiCallRecord[] = [];
  /** Monotonic counter; the last assigned `sequence`. */
  private sequence = 0;
  /** Change listeners (React `useSyncExternalStore` subscribers). */
  private listeners = new Set<() => void>();

  /**
   * @param limit Maximum records to retain; older ones are dropped. Invalid values or values
   *   below 1 fall back to {@link DEFAULT_TELEMETRY_LIMIT} / 1 respectively.
   */
  constructor(limit: number = DEFAULT_TELEMETRY_LIMIT) {
    if (typeof limit !== "number" || !Number.isFinite(limit)) {
      this.limit = DEFAULT_TELEMETRY_LIMIT;
    } else {
      this.limit = Math.max(1, Math.floor(limit));
    }
  }

  /**
   * Append one call record. `sequence` is assigned here (1-based, strictly increasing), which is
   * why callers pass `Omit<AiCallRecord, "sequence">`. Subscribers are notified afterwards; a
   * throwing subscriber is isolated and never propagates to the harness.
   */
  record(r: Omit<AiCallRecord, "sequence">): void {
    try {
      this.sequence += 1;
      const entry: AiCallRecord = { ...r, sequence: this.sequence };
      this.records.push(entry);
      while (this.records.length > this.limit) {
        this.records.shift();
      }
    } catch {
      return; // Telemetry must never break the call it is describing.
    }
    this.notify();
  }

  /**
   * Snapshot of retained records, oldest first.
   *
   * Returns a fresh array each call — safe for callers to sort/reverse, but NOT referentially
   * stable, so React consumers should read it inside a `useSyncExternalStore` getSnapshot that
   * caches, or simply re-render off the `subscribe` callback.
   */
  getRecords(): AiCallRecord[] {
    return this.records.slice();
  }

  /**
   * Drop all records and restart numbering at 1.
   *
   * NOTE FOR TESTS: `clear()` resets the sequence counter, so the next `record()` produces
   * `sequence === 1` again. Sequence numbers are monotonic *within* a log generation, not across
   * clears.
   */
  clear(): void {
    this.records = [];
    this.sequence = 0;
    this.notify();
  }

  /**
   * Register a change listener. Fired after every `record()` and `clear()`.
   * @returns An idempotent unsubscribe function.
   */
  subscribe(fn: () => void): () => void {
    if (typeof fn !== "function") return () => undefined;
    this.listeners.add(fn);
    return () => {
      try {
        this.listeners.delete(fn);
      } catch {
        // Ignore.
      }
    };
  }

  /** Fan out to listeners, isolating failures so one bad subscriber cannot starve the rest. */
  private notify(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch {
        // Ignore — a broken subscriber is not the harness's problem.
      }
    }
  }
}
