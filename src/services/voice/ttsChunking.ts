/**
 * Splits arbitrarily long text into chunks Sarvam's text-to-speech endpoint will actually accept.
 * Confirmed against the live API: a single `inputs[0]` over 500 characters is rejected with
 * `HTTP 400: inputs.0: String should have at most 500 characters` — and the knowledge-base
 * grounded fallback answers (`buildLocalFarmAnswer`) are written for on-screen reading, not
 * speech, so they routinely run well past that. Pure and DOM-free, mirroring `wavEncoder.ts`'s
 * testable style.
 */

const MAX_CHARS = 500;

/** Greedily packs sentences into ≤`maxChars` chunks so a long answer is still spoken in full, just across several TTS calls played back-to-back, rather than silently rejected. */
export function chunkTextForTts(text: string, maxChars = MAX_CHARS): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    if (sentence.length <= maxChars) {
      current = sentence;
    } else {
      // A single "sentence" (no punctuation to split on) is itself too long — hard-slice it.
      for (let i = 0; i < sentence.length; i += maxChars) {
        chunks.push(sentence.slice(i, i + maxChars));
      }
      current = "";
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
