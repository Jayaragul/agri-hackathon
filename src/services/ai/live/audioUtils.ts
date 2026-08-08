/**
 * Pure PCM/base64 conversion helpers for the Live API's audio contract: 16-bit signed
 * little-endian PCM, mono, 16kHz for input (mic -> Gemini) and typically 24kHz for output
 * (Gemini -> speaker). Kept dependency-free and DOM-free so they're testable without a browser.
 */

/** Linear-interpolation resample — good enough for speech at these rates; no need for a proper sinc filter here. */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const srcIndex = i * ratio;
    const low = Math.floor(srcIndex);
    const high = Math.min(input.length - 1, low + 1);
    const frac = srcIndex - low;
    output[i] = input[low] * (1 - frac) + input[high] * frac;
  }
  return output;
}

/** Float32 samples in [-1, 1] -> 16-bit signed PCM, clamped to avoid wraparound on out-of-range input. */
export function floatTo16BitPCM(input: Float32Array) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, input[i]));
    output[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return output;
}

/** Int16Array -> base64, little-endian byte order (the Live API's expected PCM byte order). */
export function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** base64 -> Int16Array, the inverse of `int16ToBase64` — used to decode Gemini's audio output for playback. */
export function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
}

/** 16-bit signed PCM -> Float32 in [-1, 1], for feeding an AudioBuffer during playback. */
export function int16ToFloat32(samples: Int16Array) {
  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    output[i] = samples[i] / (samples[i] < 0 ? 0x8000 : 0x7fff);
  }
  return output;
}
