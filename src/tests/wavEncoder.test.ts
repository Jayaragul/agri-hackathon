import { describe, it, expect } from "vitest";
import { encodeWavPcm16, bytesToBase64, concatFloat32 } from "../services/voice/wavEncoder";

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

describe("encodeWavPcm16", () => {
  it("writes a valid RIFF/WAVE header for mono 16-bit PCM", () => {
    const samples = new Int16Array([0, 1000, -1000, 32767, -32768]);
    const wav = encodeWavPcm16(samples, 16000);
    const view = new DataView(wav.buffer);

    expect(readAscii(wav, 0, 4)).toBe("RIFF");
    expect(readAscii(wav, 8, 4)).toBe("WAVE");
    expect(readAscii(wav, 12, 4)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16); // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(readAscii(wav, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });

  it("declares the RIFF chunk size and byte rate consistently with the data size", () => {
    const samples = new Int16Array(100).fill(42);
    const sampleRate = 16000;
    const wav = encodeWavPcm16(samples, sampleRate);
    const view = new DataView(wav.buffer);

    const dataSize = samples.length * 2;
    expect(view.getUint32(4, true)).toBe(36 + dataSize);
    expect(view.getUint32(28, true)).toBe(sampleRate * 2); // byteRate = sampleRate * blockAlign(2)
    expect(wav.length).toBe(44 + dataSize);
  });

  it("round-trips sample values exactly through the data section", () => {
    const samples = new Int16Array([0, 1000, -1000, 32767, -32768]);
    const wav = encodeWavPcm16(samples, 16000);
    const view = new DataView(wav.buffer);
    for (let i = 0; i < samples.length; i++) {
      expect(view.getInt16(44 + i * 2, true)).toBe(samples[i]);
    }
  });

  it("produces an empty-but-valid file for zero samples", () => {
    const wav = encodeWavPcm16(new Int16Array(0), 16000);
    expect(wav.length).toBe(44);
    const view = new DataView(wav.buffer);
    expect(view.getUint32(40, true)).toBe(0);
  });
});

describe("bytesToBase64", () => {
  it("encodes bytes to base64 that decodes back to the same bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 128, 64]);
    const encoded = bytesToBase64(bytes);
    const decoded = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("handles a payload larger than one internal chunk", () => {
    const bytes = new Uint8Array(0x8000 + 500).map((_, i) => i % 256);
    const encoded = bytesToBase64(bytes);
    const decoded = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    expect(decoded.length).toBe(bytes.length);
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });
});

describe("concatFloat32", () => {
  it("concatenates chunks in order", () => {
    const result = concatFloat32([new Float32Array([1, 2]), new Float32Array([3]), new Float32Array([4, 5])]);
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns an empty array for no chunks", () => {
    expect(concatFloat32([]).length).toBe(0);
  });
});
