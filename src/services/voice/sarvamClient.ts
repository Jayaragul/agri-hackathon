/**
 * Frontend client for Audio Mode's speech turns, proxied through this app's own backend
 * (`server/src/routes/voiceRoutes.ts`) so `SARVAM_API_KEY` never reaches the browser — same
 * security posture as `services/ai/transport/ServerProxyTransport.ts` for text.
 *
 * Unlike `services/memory/memoryClient.ts`, these calls are NOT silently-degrading: a farmer who
 * taps the mic needs to know if speech failed, so every function here throws a `VoiceProxyError`
 * on failure rather than resolving a safe default. The caller (`features/voice-mode/VoiceMode.tsx`,
 * `features/onboarding/OnboardingGate.tsx`) is expected to catch it and show a plain-language
 * error plus a text-input fallback, never leave the farmer staring at a stuck spinner.
 */

export class VoiceProxyError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "VoiceProxyError";
  }
}

// Direct `import.meta.env.KEY` access, not an aliased `const meta = import.meta; meta.env`
// indirection — see the comment on `resolveEnvSource` in `services/ai/runtime/harnessConfig.ts`
// for why the indirect form silently resolves to nothing under Vite's dev-mode client injection.
function readApiBase(): string {
  try {
    const raw = import.meta.env.VITE_API_BASE_URL;
    return typeof raw === "string" ? raw.trim().replace(/\/$/, "") : "";
  } catch {
    return "";
  }
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}

/** Whether the backend has a Sarvam key configured — checked once up front so the UI can offer a text-only fallback immediately instead of after a failed round-trip. */
export async function getVoiceStatus(): Promise<{ configured: boolean; languageCode: string }> {
  try {
    const response = await fetch(`${readApiBase()}/api/voice/status`);
    if (!response.ok) return { configured: false, languageCode: "ta-IN" };
    const body = (await response.json()) as { configured?: boolean; languageCode?: string };
    return { configured: Boolean(body.configured), languageCode: body.languageCode || "ta-IN" };
  } catch {
    return { configured: false, languageCode: "ta-IN" };
  }
}

/** Transcribe one recorded utterance. Throws `VoiceProxyError` on any failure — never returns a silently-empty string for a real error. */
export async function transcribeAudio(base64Data: string, mimeType: string, languageCode?: string): Promise<string> {
  const response = await fetch(`${readApiBase()}/api/voice/speech-to-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio: { mimeType, base64Data }, languageCode }),
  });
  if (!response.ok) {
    throw new VoiceProxyError(response.status, await readErrorMessage(response, "Could not transcribe audio."));
  }
  const body = (await response.json()) as { transcript?: string };
  return body.transcript ?? "";
}

/** Synthesise spoken audio for a reply. Returns a `data:` URI ready for an `<audio>` element. */
export async function synthesizeSpeech(text: string, languageCode?: string): Promise<string> {
  const response = await fetch(`${readApiBase()}/api/voice/text-to-speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, languageCode }),
  });
  if (!response.ok) {
    throw new VoiceProxyError(response.status, await readErrorMessage(response, "Could not synthesise speech."));
  }
  const body = (await response.json()) as { audio?: { mimeType: string; base64Data: string } };
  if (!body.audio) throw new VoiceProxyError(502, "No audio returned.");
  return `data:${body.audio.mimeType};base64,${body.audio.base64Data}`;
}
