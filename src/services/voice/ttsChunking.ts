/**
 * Splits arbitrarily long text into chunks Sarvam's text-to-speech endpoint will actually accept.
 * `bulbul:v3`'s documented limit is 2500 characters per `text` field
 * (docs.sarvam.ai/api-reference/text-to-speech/convert, 2026-08) — up from the 500-character
 * `inputs[0]` limit of the older batch-request shape this app used to send (see the comment on
 * `server/src/services/sarvamProxy.ts`'s `textToSpeech()`). Still chunked, not sent as one huge
 * call: the knowledge-base grounded fallback answers (`buildLocalFarmAnswer`) are written for
 * on-screen reading and can run past even 2500 characters, and shorter chunks also start playing
 * back sooner. Pure and DOM-free, mirroring `wavEncoder.ts`'s testable style.
 */

const MAX_CHARS = 2000;

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
