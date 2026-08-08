/**
 * Speaks arbitrarily long text aloud via Sarvam TTS — the shared entry point `VoiceMode.tsx` and
 * `OnboardingGate.tsx` both use instead of calling `sarvamClient.synthesizeSpeech()` directly.
 * Two responsibilities neither caller should have to reimplement:
 *
 * 1. Chunks the text under Sarvam bulbul:v3's per-call character limit (`ttsChunking.ts`) and
 *    plays each clip back-to-back, so a long knowledge-base answer is still spoken in full
 *    instead of being rejected outright.
 * 2. Never throws. Speech is a bonus on top of an answer that already succeeded and is already
 *    on screen — a synthesis failure (quota, network, an unexpected format) should never look
 *    like the answer itself failed. Playback simply stops at whichever chunk failed.
 */
import { synthesizeSpeech } from "./sarvamClient";
import { chunkTextForTts } from "./ttsChunking";

/**
 * Generous upper bound on one chunk's spoken duration (a 500-character chunk read aloud takes
 * well under this even at a slow pace). Exists purely as a safety net: if an `<audio>` element
 * ever stalls without firing `ended` or `error` — a malformed clip, a backgrounded tab, whatever
 * — this guarantees `speak()` still resolves and the UI never gets stuck disabled on "speaking…"
 * forever.
 */
const MAX_CHUNK_PLAYBACK_MS = 45_000;

function playOnce(dataUri: string): Promise<void> {
  return new Promise((resolve) => {
    const audio = new Audio(dataUri);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, MAX_CHUNK_PLAYBACK_MS);
    audio.onended = finish;
    audio.onerror = finish;
    audio.play().catch(finish);
  });
}

export async function speak(text: string, languageCode?: string): Promise<void> {
  const chunks = chunkTextForTts(text);
  for (const chunk of chunks) {
    try {
      const uri = await synthesizeSpeech(chunk, languageCode);
      await playOnce(uri);
    } catch {
      return; // Best-effort — stop speaking further chunks rather than throwing into the caller.
    }
  }
}
