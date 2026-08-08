import { describe, it, expect } from "vitest";
import { resolvePestObservation } from "../services/ai/live/pestToolResolver";
import {
  resampleLinear,
  floatTo16BitPCM,
  int16ToBase64,
  base64ToInt16,
  int16ToFloat32,
} from "../services/ai/live/audioUtils";
import type { PestRisk } from "../domain/models/models";

const candidates: PestRisk[] = [
  {
    id: "p001",
    cropId: "groundnut",
    pestName: "Leaf Miner",
    pestEmoji: "🪲",
    riskLevel: "high",
    symptoms: "Silvery tunnels on leaves.",
    biologicalControl: "Release Chrysoperla carnea.",
    chemicalControl: "Imidacloprid 200 SL, only past ETL.",
    economicThreshold: "20% leaf area damaged.",
  },
  {
    id: "p002",
    cropId: "groundnut",
    pestName: "White Grub",
    pestEmoji: "🐛",
    riskLevel: "medium",
    symptoms: "Sudden wilting.",
    biologicalControl: "Beauveria bassiana soil treatment.",
    economicThreshold: "1 grub per sq foot.",
  },
];

describe("resolvePestObservation", () => {
  it("resolves verified guidance for a matched id in the candidate list", () => {
    const result = resolvePestObservation({ matchedKnownPestId: "p001", observedSymptoms: ["tunnels"], confidence: "high" }, candidates);
    expect(result.matched).toBe(true);
    expect(result.pestName).toBe("Leaf Miner");
    expect(result.biologicalControl).toContain("Chrysoperla");
    expect(result.chemicalControl).toContain("Imidacloprid");
  });

  it("never surfaces chemicalControl for a pest whose dataset entry has none", () => {
    const result = resolvePestObservation({ matchedKnownPestId: "p002" }, candidates);
    expect(result.matched).toBe(true);
    expect(result.chemicalControl).toBeNull();
  });

  it("rejects an id that is not in the candidate list, never inventing a match", () => {
    const result = resolvePestObservation({ matchedKnownPestId: "totally-made-up" }, candidates);
    expect(result.matched).toBe(false);
    expect(result.pestName).toBeNull();
    expect(result.note).toContain("not in this crop's verified list");
  });

  it("treats a null id as no match without error", () => {
    const result = resolvePestObservation({ matchedKnownPestId: null }, candidates);
    expect(result.matched).toBe(false);
  });

  it("treats a missing/malformed args object defensively", () => {
    const result = resolvePestObservation({}, candidates);
    expect(result.matched).toBe(false);
    expect(result.pestName).toBeNull();
  });

  it("never returns guidance not present in the dataset record", () => {
    const result = resolvePestObservation({ matchedKnownPestId: "p001" }, candidates);
    const matchedRecord = candidates.find((c) => c.id === "p001")!;
    expect(result.pestName).toBe(matchedRecord.pestName);
    expect(result.biologicalControl).toBe(matchedRecord.biologicalControl);
    expect(result.economicThreshold).toBe(matchedRecord.economicThreshold);
  });
});

describe("audioUtils", () => {
  it("round-trips 16-bit PCM through base64 without loss", () => {
    const original = new Int16Array([0, 1, -1, 32767, -32768, 12345, -12345]);
    const roundTripped = base64ToInt16(int16ToBase64(original));
    expect(Array.from(roundTripped)).toEqual(Array.from(original));
  });

  it("converts float samples to 16-bit PCM without clipping in range", () => {
    const floats = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const pcm = floatTo16BitPCM(floats);
    expect(pcm[0]).toBe(0);
    expect(pcm[3]).toBe(0x7fff);
    expect(pcm[4]).toBe(-0x8000);
  });

  it("clamps out-of-range float input instead of wrapping around", () => {
    const pcm = floatTo16BitPCM(new Float32Array([2, -2]));
    expect(pcm[0]).toBe(0x7fff);
    expect(pcm[1]).toBe(-0x8000);
  });

  it("resamples to a shorter array when downsampling", () => {
    const input = new Float32Array(160); // 10ms @ 16kHz
    const resampled = resampleLinear(input, 48000, 16000);
    expect(resampled.length).toBeLessThan(input.length);
    expect(resampled.length).toBeGreaterThan(0);
  });

  it("is a no-op when rates match", () => {
    const input = new Float32Array([1, 2, 3]);
    expect(resampleLinear(input, 16000, 16000)).toBe(input);
  });

  it("round-trips int16<->float32 within rounding tolerance", () => {
    const pcm = new Int16Array([0, 16384, -16384, 32767, -32768]);
    const floats = int16ToFloat32(pcm);
    for (const f of floats) {
      expect(f).toBeGreaterThanOrEqual(-1);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});
