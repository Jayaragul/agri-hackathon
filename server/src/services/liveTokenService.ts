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
import { GoogleGenAI, Modality } from "@google/genai";
import { resolveGeminiApiKey } from "./env";
import {
  buildCropDoctorSystemInstruction,
  CROP_DOCTOR_TOOL_DECLARATION,
  type FarmerContextSummary,
  type PestCandidateSummary,
} from "./cropDoctorConfig";

const DEFAULT_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-09-2025";
const TOKEN_TTL_MINUTES = 30;
const SESSION_START_WINDOW_MINUTES = 5;

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
 * behaviour (each token maps to one intended conversation, not an open-ended credential).
 */
export async function createLiveToken(
  cropName: string,
  candidates: PestCandidateSummary[],
  farmerContext?: FarmerContextSummary
): Promise<LiveTokenResult> {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    throw new LiveTokenError(503, "Gemini is not configured on the server (GEMINI_API_KEY is unset).");
  }

  const model = process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL;
  const client = new GoogleGenAI({ apiKey });
  const expireTime = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + SESSION_START_WINDOW_MINUTES * 60 * 1000).toISOString();

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
    if (err instanceof LiveTokenError) throw err;
    throw new LiveTokenError(502, err instanceof Error ? err.message : "Could not mint a live session token.");
  }
}
