/**
 * In-memory `AiTransport` for tests. No network, no real clock, no randomness.
 *
 * The entire harness test suite runs against this, so the single most important property is
 * that it is boring: every call is synchronous-ish and fully determined by the script handed
 * to the constructor. If this file ever becomes clever, the suite becomes flaky.
 *
 * Scripting model: steps are consumed in order, and once the script is exhausted the LAST step
 * repeats forever. That makes the common cases trivial to express —
 *   `new MockTransport([{ text: goodJson }])`                  -> always succeeds
 *   `new MockTransport([{ error: boom }])`                     -> always fails
 *   `new MockTransport([{ error: boom }, { text: goodJson }])` -> fails once, then succeeds
 * which is exactly the shape needed to exercise retry, repair, and circuit-breaker paths.
 */

import { AiHarnessError } from "../contracts/aiTypes";
import type {
  AiTransport,
  GenerateOptions,
  PromptPayload,
  TransportResult,
} from "../contracts/aiTypes";

/**
 * One scripted response. Exactly one of `text` / `error` is meaningful; `error` wins if both
 * are set. `modelId` and `groundingUrls` are optional extras for assertions that care.
 */
export interface MockTransportStep {
  text?: string;
  error?: Error;
  delayMs?: number;
  modelId?: string;
  groundingUrls?: string[];
}

/** Either a scripted step list or a function computing a result per call. */
export type MockTransportScript = MockTransportStep[] | (() => TransportResult);

export interface MockTransportOptions {
  /** Model id reported when a step does not override it. */
  modelId?: string;
}

const DEFAULT_MODEL_ID = "mock-model";

/** Abort-aware sleep. Rejects immediately if the signal is already aborted. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AiHarnessError("MockTransport call aborted.", "timeout"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new AiHarnessError("MockTransport call aborted.", "timeout"));
    }
    signal?.addEventListener("abort", onAbort);
  });
}

export class MockTransport implements AiTransport {
  readonly id = "mock";

  /** Every payload this transport was asked to generate, in order. Assert against this. */
  readonly calls: PromptPayload[] = [];

  /** Per-call options, index-aligned with `calls` (handy for asserting responseSchema use). */
  readonly callOptions: GenerateOptions[] = [];

  /** Flip to false to simulate a transport the harness should skip entirely. */
  available = true;

  private readonly steps: MockTransportStep[] | null;
  private readonly producer: (() => TransportResult) | null;
  private readonly defaultModelId: string;
  private cursor = 0;

  constructor(script: MockTransportScript, options?: MockTransportOptions) {
    if (typeof script === "function") {
      this.producer = script;
      this.steps = null;
    } else {
      this.producer = null;
      this.steps = Array.isArray(script) ? script.slice() : [];
    }
    this.defaultModelId = options?.modelId ?? DEFAULT_MODEL_ID;
  }

  isAvailable(): boolean {
    return this.available;
  }

  /** How many times `generate` has been invoked. Equivalent to `calls.length`. */
  get callCount(): number {
    return this.calls.length;
  }

  /** The most recent payload, or undefined if never called. */
  get lastCall(): PromptPayload | undefined {
    return this.calls[this.calls.length - 1];
  }

  /** Forget recorded calls and rewind the script. */
  reset(): void {
    this.calls.length = 0;
    this.callOptions.length = 0;
    this.cursor = 0;
  }

  async generate(payload: PromptPayload, opts: GenerateOptions): Promise<TransportResult> {
    this.calls.push(payload);
    this.callOptions.push(opts);

    if (this.producer !== null) {
      return this.producer();
    }

    const steps = this.steps ?? [];
    if (steps.length === 0) {
      throw new AiHarnessError("MockTransport was constructed with an empty script.", "unknown");
    }

    // Consume in order, then pin to the last step forever.
    const index = Math.min(this.cursor, steps.length - 1);
    this.cursor += 1;
    const step = steps[index];

    const delayMs = typeof step.delayMs === "number" && step.delayMs > 0 ? step.delayMs : 0;
    if (delayMs > 0) {
      const budget =
        typeof opts.timeoutMs === "number" && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
          ? opts.timeoutMs
          : Number.POSITIVE_INFINITY;
      if (delayMs >= budget) {
        // Simulate a timeout without ever actually waiting out the budget.
        throw new AiHarnessError(
          `MockTransport timed out after ${opts.timeoutMs}ms.`,
          "timeout"
        );
      }
      await sleep(delayMs, opts.signal);
    }

    if (step.error) {
      throw step.error;
    }

    const modelId = step.modelId ?? this.defaultModelId;
    return step.groundingUrls
      ? { text: step.text ?? "", modelId, groundingUrls: step.groundingUrls.slice() }
      : { text: step.text ?? "", modelId };
  }
}
