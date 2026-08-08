/**
 * Encodes 16-bit PCM samples into a real WAV (RIFF/WAVE) file — pure and DOM-free, mirroring
 * `services/ai/live/audioUtils.ts`'s testable style. This exists because Sarvam AI's
 * `/speech-to-text` endpoint validates the declared content-type against a strict allowlist
 * (`audio/wav`, `mp3`, `aac`, `aiff`, raw PCM, `application/octet-stream` — notably NOT
 * `audio/webm`, which is all a browser's `MediaRecorder` can produce on most platforms). Rather
 * than mislabeling a webm/opus blob as "audio/wav" (works only if the server never actually
 * decodes the bytes), `AudioRecorder.ts` captures raw PCM via the Web Audio API and this module
 * wraps it in a genuine WAV container, so the declared type matches the real bytes.
 */

function writeAsciiString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Mono, 16-bit PCM, little-endian — the simplest WAV variant, and one of Sarvam's explicitly accepted formats. */
export function encodeWavPcm16(samples: Int16Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAsciiString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAsciiString(view, 8, "WAVE");
  writeAsciiString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size (16 for PCM)
  view.setUint16(20, 1, true); // audio format: 1 = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAsciiString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1, offset += 2) {
    view.setInt16(offset, samples[i], true);
  }

  return new Uint8Array(buffer);
}

/** Chunked to avoid blowing the call stack on `String.fromCharCode(...bytes)` for long recordings. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** Concatenates recorder chunks captured across multiple `onaudioprocess` callbacks into one continuous buffer. */
export function concatFloat32(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}
