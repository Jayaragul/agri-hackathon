/**
 * Live video+audio "Crop Doctor" session: the farmer's browser connects DIRECTLY to Google's
 * Gemini Live API over WebSocket using a short-lived ephemeral token minted by this app's own
 * backend (see `ephemeralToken.ts`) — no relay server, no client-exposed API key.
 *
 * Architecturally this is the same "engine decides, AI perceives/explains" boundary as every
 * other agent in this app, just over a faster channel: the model watches/listens and calls the
 * `reportPestObservation` tool (declared server-side, baked into the token); this class resolves
 * that call against the SAME verified per-crop pest list `PestIdentificationService` already
 * uses (`pestToolResolver.ts`), and only the resolved, dataset-sourced guidance is sent back for
 * the model to relay. The model is never treated as a source of treatment truth.
 */
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import type { Crop, PestRisk } from "../../../domain/models/models";
import { fetchLiveToken, type FarmerContextSummary } from "./ephemeralToken";
import { resolvePestObservation, type PestToolResult } from "./pestToolResolver";
import { floatTo16BitPCM, int16ToBase64, base64ToInt16, int16ToFloat32, resampleLinear } from "./audioUtils";

const CROP_DOCTOR_TOOL_NAME = "reportPestObservation";
const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
const VIDEO_FRAME_INTERVAL_MS = 1_500;
const VIDEO_FRAME_MAX_WIDTH = 640;
const AUDIO_CHUNK_SIZE = 4_096;

export type CropDoctorStatus = "idle" | "connecting" | "connected" | "closed" | "error";

export interface TranscriptEntry {
  speaker: "farmer" | "doctor";
  text: string;
}

export interface CropDoctorEvents {
  onStatusChange?: (status: CropDoctorStatus) => void;
  onTranscript?: (entry: TranscriptEntry) => void;
  onPestResolved?: (result: PestToolResult) => void;
  onError?: (message: string) => void;
}

/** Everything torn down in `stop()`, grouped so cleanup can't accidentally miss one. */
interface ActiveResources {
  mediaStream: MediaStream;
  audioContext: AudioContext;
  micSourceNode: MediaStreamAudioSourceNode;
  micProcessorNode: ScriptProcessorNode;
  playbackContext: AudioContext;
  frameIntervalId: ReturnType<typeof setInterval>;
  session: Session;
}

export class CropDoctorSession {
  private readonly crop: Crop;
  private readonly candidates: PestRisk[];
  private readonly events: CropDoctorEvents;
  private resources: ActiveResources | null = null;
  private nextPlaybackTime = 0;
  private status: CropDoctorStatus = "idle";

  constructor(crop: Crop, candidates: PestRisk[], events: CropDoctorEvents, private readonly farmerContext?: FarmerContextSummary) {
    this.crop = crop;
    this.candidates = candidates;
    this.events = events;
  }

  getStatus(): CropDoctorStatus {
    return this.status;
  }

  private setStatus(status: CropDoctorStatus): void {
    this.status = status;
    this.events.onStatusChange?.(status);
  }

  /** Starts the camera+mic, connects to Gemini Live, and begins streaming. `videoEl` shows the local camera preview. */
  async start(videoEl: HTMLVideoElement): Promise<void> {
    if (this.resources) return;
    this.setStatus("connecting");

    let mediaStream: MediaStream;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: true,
      });
    } catch (err) {
      this.setStatus("error");
      this.events.onError?.(err instanceof Error ? `Could not access camera/microphone: ${err.message}` : "Could not access camera/microphone.");
      throw err;
    }

    videoEl.srcObject = mediaStream;
    await videoEl.play().catch(() => {
      // Autoplay can be blocked until a user gesture; the farmer tapping "Start" already counts as one in practice.
    });

    let token;
    try {
      token = await fetchLiveToken(this.crop.name, this.candidates, this.farmerContext);
    } catch (err) {
      mediaStream.getTracks().forEach((track) => track.stop());
      this.setStatus("error");
      this.events.onError?.(err instanceof Error ? err.message : "Could not start Crop Doctor.");
      throw err;
    }

    const client = new GoogleGenAI({ apiKey: token.token });
    let session: Session;
    try {
      session = await client.live.connect({
        model: token.model,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => this.setStatus("connected"),
          onmessage: (message) => this.handleServerMessage(message),
          onerror: (event) => {
            this.setStatus("error");
            this.events.onError?.(`Live connection error: ${event.message ?? "unknown"}.`);
          },
          onclose: () => this.setStatus("closed"),
        },
      });
    } catch (err) {
      mediaStream.getTracks().forEach((track) => track.stop());
      this.setStatus("error");
      this.events.onError?.(err instanceof Error ? `Could not connect to Crop Doctor: ${err.message}` : "Could not connect to Crop Doctor.");
      throw err;
    }

    const audioContext = new AudioContext();
    const micSourceNode = audioContext.createMediaStreamSource(mediaStream);
    const micProcessorNode = audioContext.createScriptProcessor(AUDIO_CHUNK_SIZE, 1, 1);
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;

    micProcessorNode.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      const resampled = resampleLinear(inputData, audioContext.sampleRate, INPUT_SAMPLE_RATE);
      const pcm = floatTo16BitPCM(resampled);
      try {
        session.sendRealtimeInput({ audio: { data: int16ToBase64(pcm), mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` } });
      } catch {
        // A send on a closing/closed socket is not actionable — the onclose/onerror callback already reports it.
      }
    };
    micSourceNode.connect(micProcessorNode);
    micProcessorNode.connect(silentGain);
    silentGain.connect(audioContext.destination);

    const frameIntervalId = setInterval(() => this.sendVideoFrame(videoEl, session), VIDEO_FRAME_INTERVAL_MS);

    this.resources = {
      mediaStream,
      audioContext,
      micSourceNode,
      micProcessorNode,
      playbackContext: new AudioContext(),
      frameIntervalId,
      session,
    };
    this.nextPlaybackTime = 0;
  }

  /** Tears down the camera, mic, audio graph, and the live connection. Safe to call multiple times. */
  stop(): void {
    if (!this.resources) return;
    const { mediaStream, audioContext, micSourceNode, micProcessorNode, playbackContext, frameIntervalId, session } = this.resources;

    clearInterval(frameIntervalId);
    try {
      micProcessorNode.disconnect();
      micSourceNode.disconnect();
    } catch {
      // Already disconnected.
    }
    mediaStream.getTracks().forEach((track) => track.stop());
    void audioContext.close().catch(() => {});
    void playbackContext.close().catch(() => {});
    try {
      session.close();
    } catch {
      // Already closed.
    }

    this.resources = null;
    this.setStatus("closed");
  }

  private sendVideoFrame(videoEl: HTMLVideoElement, session: Session): void {
    if (videoEl.videoWidth === 0 || videoEl.videoHeight === 0) return;
    const scale = Math.min(1, VIDEO_FRAME_MAX_WIDTH / videoEl.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(videoEl.videoWidth * scale);
    canvas.height = Math.round(videoEl.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    try {
      session.sendRealtimeInput({ video: { data: base64, mimeType: "image/jpeg" } });
    } catch {
      // See mic send comment — a closing socket reports itself via onerror/onclose.
    }
  }

  private handleServerMessage(message: LiveServerMessage): void {
    if (message.toolCall?.functionCalls) {
      for (const call of message.toolCall.functionCalls) {
        if (call.name !== CROP_DOCTOR_TOOL_NAME) continue;
        const result = resolvePestObservation(call.args ?? {}, this.candidates);
        this.events.onPestResolved?.(result);
        try {
          this.resources?.session.sendToolResponse({
            functionResponses: [{ id: call.id, name: call.name, response: { ...result } }],
          });
        } catch {
          // A send on a closing socket is not actionable.
        }
      }
    }

    const outputText = message.serverContent?.outputTranscription?.text;
    if (outputText) this.events.onTranscript?.({ speaker: "doctor", text: outputText });

    const inputText = message.serverContent?.inputTranscription?.text;
    if (inputText) this.events.onTranscript?.({ speaker: "farmer", text: inputText });

    const audioBase64 = message.data;
    if (audioBase64 && this.resources) this.playAudioChunk(audioBase64, this.resources.playbackContext);
  }

  /** Queues one PCM chunk for gap-free sequential playback by scheduling it after whatever is already queued. */
  private playAudioChunk(base64: string, playbackContext: AudioContext): void {
    const pcm = base64ToInt16(base64);
    if (pcm.length === 0) return;
    const floatSamples = int16ToFloat32(pcm);

    const buffer = playbackContext.createBuffer(1, floatSamples.length, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(floatSamples, 0);

    const source = playbackContext.createBufferSource();
    source.buffer = buffer;
    source.connect(playbackContext.destination);

    const startAt = Math.max(playbackContext.currentTime, this.nextPlaybackTime);
    source.start(startAt);
    this.nextPlaybackTime = startAt + buffer.duration;
  }
}
