/**
 * Server-side Sarvam AI proxy — the audio counterpart to `geminiProxy.ts`. `SARVAM_API_KEY` is
 * read from the server's own environment and never reaches the browser; the frontend's
 * `services/voice/sarvamClient.ts` only ever talks to this server's own `/api/voice/*` routes.
 *
 * Sarvam has no ephemeral-token/direct-connect mode like Gemini Live, so unlike Crop Doctor's
 * live video (browser connects straight to Google), Audio Mode's speech turns are proxied
 * through here in full — the same trust boundary as `/api/ai/generate`, just for audio instead
 * of text.
 */

const SARVAM_BASE = "https://api.sarvam.ai";
const MAX_ERROR_BODY_CHARS = 300;

const STT_MODEL = "saaras:v3";
const TTS_MODEL = "bulbul:v3";
const TTS_SPEAKER = "mani";
/** bulbul:v3's own documented default — confirmed against docs.sarvam.ai/api-reference/text-to-speech/convert. */
const TTS_SAMPLE_RATE = 24000;

export class SarvamProxyError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "SarvamProxyError";
  }
}

export interface AudioPayload {
  mimeType: string;
  base64Data: string;
}

function truncate(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/**
 * Sarvam's `/speech-to-text` validates the multipart file's declared content-type against a
 * strict allowlist — confirmed against the live API: `wav`/`x-wav`, `mp3`/`mpeg`, `aac`, `aiff`,
 * raw PCM, and `application/octet-stream`. Notably NOT `webm` or `ogg`, despite those being
 * listed as "supported" in Sarvam's general docs — this project's own frontend
 * (`services/voice/AudioRecorder.ts`) only ever sends genuine WAV, so `wav` is both the default
 * and, in practice, the only path exercised; the other branches exist only as a defensive
 * mapping for a differently-encoded caller.
 */
function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes("mp3") || mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("aac")) return "aac";
  if (mimeType.includes("aiff")) return "aiff";
  return "wav";
}

/** Transcribe one farmer utterance. `audio` is whatever the browser's MediaRecorder produced (usually webm/opus) — Sarvam's STT accepts common container formats directly, no client-side transcoding needed. */
export async function speechToText(
  apiKey: string,
  audio: AudioPayload,
  languageCode: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  if (!apiKey) throw new SarvamProxyError(503, "Sarvam is not configured on the server (SARVAM_API_KEY is unset).");
  if (!audio?.base64Data) throw new SarvamProxyError(400, "Audio data is required.");

  const bytes = Buffer.from(audio.base64Data, "base64");
  const blob = new Blob([bytes], { type: audio.mimeType || "audio/webm" });
  const form = new FormData();
  form.append("file", blob, `audio.${extensionForMimeType(audio.mimeType || "")}`);
  form.append("language_code", languageCode);
  form.append("model", STT_MODEL);

  const response = await fetchImpl(`${SARVAM_BASE}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": apiKey },
    body: form,
  });

  if (!response.ok) {
    const detail = truncate(await response.text().catch(() => ""), MAX_ERROR_BODY_CHARS);
    throw new SarvamProxyError(response.status, `Sarvam speech-to-text failed with HTTP ${response.status}${detail ? `: ${detail}` : "."}`);
  }

  const payload = (await response.json()) as { transcript?: string };
  return (payload.transcript ?? "").trim();
}

/**
 * Speak one reply back. Returns a base64-encoded WAV clip ready for an `<audio>` data URI on the
 * frontend.
 *
 * Request shape confirmed against `docs.sarvam.ai/api-reference/text-to-speech/convert`
 * (2026-08): `bulbul:v3` takes a single `text` string (up to 2500 chars) and `language_code` —
 * NOT the `inputs: string[]` / `target_language_code` shape this previously sent, which is the
 * older `bulbul:v1`/`v2` batch-synthesis request format. `enable_preprocessing`, `pitch`, and
 * `loudness` are all explicitly "not supported" for v3 per the same docs, so none are sent here.
 */
export async function textToSpeech(
  apiKey: string,
  text: string,
  languageCode: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  if (!apiKey) throw new SarvamProxyError(503, "Sarvam is not configured on the server (SARVAM_API_KEY is unset).");
  if (!text?.trim()) throw new SarvamProxyError(400, "Text to speak is required.");

  const response = await fetchImpl(`${SARVAM_BASE}/text-to-speech`, {
    method: "POST",
    headers: { "api-subscription-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      language_code: languageCode,
      speaker: TTS_SPEAKER,
      pace: 1.0,
      speech_sample_rate: TTS_SAMPLE_RATE,
      model: TTS_MODEL,
    }),
  });

  if (!response.ok) {
    const detail = truncate(await response.text().catch(() => ""), MAX_ERROR_BODY_CHARS);
    throw new SarvamProxyError(response.status, `Sarvam text-to-speech failed with HTTP ${response.status}${detail ? `: ${detail}` : "."}`);
  }

  const payload = (await response.json()) as { audios?: string[] };
  const audio = payload.audios?.[0];
  if (!audio) throw new SarvamProxyError(502, "Sarvam text-to-speech returned no audio.");
  return audio;
}
