import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { speak } from "../services/voice/speak";
import * as sarvamClient from "../services/voice/sarvamClient";

/** Minimal stand-in for HTMLAudioElement — captures the handlers `speak.ts` wires up so tests can drive them directly instead of depending on real audio playback timing. */
class FakeAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src: string;
  playCalls = 0;
  static instances: FakeAudio[] = [];
  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    this.playCalls += 1;
    return Promise.resolve();
  }
}

async function flushMicrotasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("speak", () => {
  beforeEach(() => {
    FakeAudio.instances = [];
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("plays a single short chunk and resolves once it ends", async () => {
    vi.spyOn(sarvamClient, "synthesizeSpeech").mockResolvedValue("data:audio/wav;base64,abc");

    const promise = speak("A short reply.");
    await flushMicrotasks();
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].playCalls).toBe(1);

    FakeAudio.instances[0].onended?.();
    await promise;
  });

  it("plays a long answer as multiple chunks, one after another, waiting for each to end", async () => {
    vi.spyOn(sarvamClient, "synthesizeSpeech").mockImplementation(async (text) => `data:audio/wav;base64,${text.length}`);

    const sentenceA = `${"A".repeat(300)}.`;
    const sentenceB = `${"B".repeat(300)}.`;
    const promise = speak(`${sentenceA} ${sentenceB}`);

    await flushMicrotasks();
    expect(FakeAudio.instances).toHaveLength(1);

    FakeAudio.instances[0].onended?.();
    await flushMicrotasks();
    expect(FakeAudio.instances).toHaveLength(2);

    FakeAudio.instances[1].onended?.();
    await promise;
  });

  it("resolves via the safety-net timeout if a clip never fires ended or error", async () => {
    vi.useFakeTimers();
    vi.spyOn(sarvamClient, "synthesizeSpeech").mockResolvedValue("data:audio/wav;base64,stuck");

    let resolved = false;
    const promise = speak("A reply whose audio element hangs forever.").then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(FakeAudio.instances).toHaveLength(1);
    expect(resolved).toBe(false);

    // Never call onended/onerror — only the timeout should be able to unblock this.
    await vi.advanceTimersByTimeAsync(45_000);
    await promise;
    expect(resolved).toBe(true);
  });

  it("stops speaking further chunks if synthesis fails partway through, without throwing", async () => {
    let call = 0;
    vi.spyOn(sarvamClient, "synthesizeSpeech").mockImplementation(async () => {
      call += 1;
      if (call === 1) return "data:audio/wav;base64,first";
      throw new Error("network down");
    });

    const sentenceA = `${"A".repeat(300)}.`;
    const sentenceB = `${"B".repeat(300)}.`;
    const promise = speak(`${sentenceA} ${sentenceB}`);

    await flushMicrotasks();
    expect(FakeAudio.instances).toHaveLength(1);
    FakeAudio.instances[0].onended?.();

    await expect(promise).resolves.toBeUndefined();
    expect(FakeAudio.instances).toHaveLength(1); // second chunk's synthesis failed before an Audio element was ever created
  });

  it("resolves immediately for empty text without creating an audio element", async () => {
    vi.spyOn(sarvamClient, "synthesizeSpeech");
    await speak("   ");
    expect(FakeAudio.instances).toHaveLength(0);
    expect(sarvamClient.synthesizeSpeech).not.toHaveBeenCalled();
  });
});
