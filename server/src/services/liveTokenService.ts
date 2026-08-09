/**
 * Mints short-lived, single-use Gemini Live API tokens so the farmer's browser can connect
 * DIRECTLY to Google's Live API WebSocket without ever seeing `GEMINI_API_KEY`. This is Google's
 * own recommended pattern for client apps (see ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens)
 * and avoids running a full audio/video relay through this server, which would add cost,
 * latency, and a single point of failure for no security benefit.
 *
 * `liveConnectConstraints` locks the token to a specific model/config (including the system
 * instruction and tool declaration) — the browser cannot override any of it, so the Crop
 * Doctor's persona and its "the list is closed" guardrail can never be tampered with client-side.
 */
import { GoogleGenAI, MediaResolution, Modality } from "@google/genai";
import { resolveGeminiApiKey } from "./env";
import {
  buildCropDoctorSystemInstruction,
  CROP_DOCTOR_TOOL_DECLARATION,
  type FarmerContextSummary,
  type PestCandidateSummary,
} from "./cropDoctorConfig";

/**
 * Verified-current live model chain (2026-08, confirmed against
 * ai.google.dev/gemini-api/docs/live-api/capabilities). `gemini-3.1-flash-live-preview` is the
 * current Gemini 3 generation native-audio-video live model; the two 2.5-generation dated
 * variants are kept as fallbacks in case the 3.1 preview id is rotated or briefly unavailable —
 * same "walk the chain on a model-not-found error" discipline as the text harness's
 * `DEFAULT_MODEL_CHAIN` (`server/src/services/geminiProxy.ts`), just applied to token minting
 * instead of a per-call REST request.
 */
const DEFAULT_LIVE_MODEL_CHAIN = [
  "gemini-3.1-flash-live-preview",
  "gemini-2.5-flash-native-audio-preview-12-2025",
  "gemini-2.5-flash-native-audio-preview-09-2025",
];
const TOKEN_TTL_MINUTES = 30;
const SESSION_START_WINDOW_MINUTES = 5;

/** Only a missing/unusable model id justifies advancing to the next model in the chain — mirrors `GeminiSdkTransport`'s `looksLikeModelNotFound`. */
function looksLikeModelNotFound(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes("not_found") ||
    message.includes("not found") ||
    message.includes("is not supported") ||
    message.includes("unsupported model") ||
    message.includes("unknown model")
  );
}

/** Operator override (single id) if set, otherwise the verified chain, comma-split for a manual multi-id override. */
function resolveLiveModelChain(): string[] {
  const raw = process.env.GEMINI_LIVE_MODEL?.trim();
  if (!raw) return DEFAULT_LIVE_MODEL_CHAIN;
  const chain = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return chain.length > 0 ? chain : DEFAULT_LIVE_MODEL_CHAIN;
}

export interface LiveTokenResult {
  token: string;
  expireTime: string;
  model: string;
}

export class LiveTokenError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "LiveTokenError";
  }
}

/**
 * Mint one ephemeral token, pre-configured for a Crop Doctor session on `cropName` with the
 * supplied verified candidate pest list. `uses: 1` means the token is good for exactly one
 * session — a farmer who disconnects and reconnects needs a fresh token, which is the intended
 * behaviour (each token maps to one intended conversation, not an open-ended credential); the
 * fresh token still carries `resumptionHandle` forward when supplied, so the CONVERSATION itself
 * (Gemini's own session state) survives a reconnect even though the token is single-use.
 *
 * Two settings close a real gap in the previous implementation, confirmed against
 * ai.google.dev/gemini-api/docs/live-session (2026-08): a video session is capped at just 2
 * minutes without `contextWindowCompression` — a farmer would have been silently disconnected
 * mid-diagnosis. `mediaResolution: MEDIA_RESOLUTION_LOW` also cuts per-frame token cost (64 vs
 * 256 tokens) for the periodic JPEG snapshots this app sends, which is plenty for pest-symptom
 * classification and not a fine-detail-recognition task.
 */
export async function createLiveToken(
  cropName: string,
  candidates: PestCandidateSummary[],
  farmerContext?: FarmerContextSummary,
  resumptionHandle?: string
): Promise<LiveTokenResult> {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    throw new LiveTokenError(503, "Gemini is not configured on the server (GEMINI_API_KEY is unset).");
  }

  const client = new GoogleGenAI({ apiKey });
  const expireTime = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + SESSION_START_WINDOW_MINUTES * 60 * 1000).toISOString();

  const chain = resolveLiveModelChain();
  let lastError: unknown = new Error("No live model in the chain could be reached.");

  for (const model of chain) {
    try {
      const token = await client.authTokens.create({
        config: {
          uses: 1,
          expireTime,
          newSessionExpireTime,
          liveConnectConstraints: {
            model,
            config: {
              responseModalities: [Modality.AUDIO],
              systemInstruction: {
                parts: [{ text: buildCropDoctorSystemInstruction(cropName, candidates, farmerContext) }],
              },
              tools: [{ functionDeclarations: [CROP_DOCTOR_TOOL_DECLARATION] }],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW,
              contextWindowCompression: { slidingWindow: {} },
              // `transparent: true` is a Vertex AI / Gemini Enterprise Agent Platform-only flag —
              // this app authenticates with a plain GEMINI_API_KEY (Gemini Developer API mode),
              // which rejects it outright ("transparent parameter is only supported in Gemini
              // Enterprise Agent Platform mode, not in Gemini Developer API mode"), failing the
              // token mint before a Crop Doctor session can even open. Resumption itself still
              // works via `handle` alone — the server sends `sessionResumptionUpdate` messages
              // for a plain (non-transparent) resumable session in Developer API mode too;
              // `CropDoctorSession.ts` already just reads `newHandle` off whatever update arrives.
              sessionResumption: { handle: resumptionHandle },
            },
          },
        },
      });

      const tokenName = (token as { name?: string }).name;
      if (!tokenName) throw new Error("Gemini did not return a token name.");

      return {
        token: tokenName,
        expireTime: (token as { expireTime?: string }).expireTime ?? expireTime,
        model,
      };
    } catch (err) {
      lastError = err;
      if (looksLikeModelNotFound(err)) continue; // Dead/rotated model id — try the next one.
      break; // Any other failure (auth, quota, malformed request) is real; stop immediately.
    }
  }

  throw new LiveTokenError(502, lastError instanceof Error ? lastError.message : "Could not mint a live session token.");
}
