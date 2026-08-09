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
 *
 * Session resumption: a Live API WebSocket connection has a ~10-minute lifetime regardless of
 * activity (confirmed against ai.google.dev/gemini-api/docs/live-session, 2026-08), so an
 * unexpected disconnect is a NORMAL event for any call longer than that, not a failure. The
 * server bakes `sessionResumption: { transparent: true }` into every minted token; this class
 * tracks the resulting `sessionResumptionUpdate` handle and, on an unexpected close, mints one
 * fresh token carrying that handle forward and reconnects automatically — the farmer sees a
 * brief "reconnecting…" status rather than the call silently dying mid-diagnosis. Capped at one
 * automatic attempt so a genuinely dead network doesn't retry forever.
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
const MAX_AUTO_RECONNECTS = 1;

export type CropDoctorStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed" | "error";

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

/** The live WebSocket session plus the interval that streams video into it — replaced wholesale on a reconnect, unlike the camera/mic graph below which stays alive across one. */
interface LiveConnection {
  session: Session;
  frameIntervalId: ReturnType<typeof setInterval>;
}

/** Camera/mic capture, acquired once per `start()` call and torn down only in `stop()` — a reconnect replaces `LiveConnection` but never re-asks for camera/mic permission. */
interface MediaResources {
  mediaStream: MediaStream;
  audioContext: AudioContext;
  micSourceNode: MediaStreamAudioSourceNode;
  micProcessorNode: ScriptProcessorNode;
  playbackContext: AudioContext;
}

export class CropDoctorSession {
  private readonly crop: Crop;
  private readonly candidates: PestRisk[];
  private readonly events: CropDoctorEvents;
  private media: MediaResources | null = null;
  private connection: LiveConnection | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private nextPlaybackTime = 0;
  private status: CropDoctorStatus = "idle";
  private resumptionHandle: string | null = null;
  private stopping = false;
  private reconnectCount = 0;

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
    if (this.media) return;
    this.setStatus("connecting");
    this.stopping = false;
    this.reconnectCount = 0;
    this.videoEl = videoEl;

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

    let connection: LiveConnection;
    try {
      connection = await this.connectLive();
    } catch (err) {
      mediaStream.getTracks().forEach((track) => track.stop());
      this.setStatus("error");
      this.events.onError?.(err instanceof Error ? `Could not start Crop Doctor: ${err.message}` : "Could not start Crop Doctor.");
      throw err;
    }

    const audioContext = new AudioContext();
    const micSourceNode = audioContext.createMediaStreamSource(mediaStream);
    const micProcessorNode = audioContext.createScriptProcessor(AUDIO_CHUNK_SIZE, 1, 1);
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;

    // Reads `this.connection?.session` at send time rather than closing over the initial
    // session, so a reconnect (which replaces `this.connection`) is picked up automatically
    // without re-wiring the audio graph or asking for mic/camera permission again.
    micProcessorNode.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      const resampled = resampleLinear(inputData, audioContext.sampleRate, INPUT_SAMPLE_RATE);
      const pcm = floatTo16BitPCM(resampled);
      try {
        this.connection?.session.sendRealtimeInput({ audio: { data: int16ToBase64(pcm), mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` } });
      } catch {
        // A send on a closing/closed socket is not actionable — the onclose/onerror callback already reports it.
      }
    };
    micSourceNode.connect(micProcessorNode);
    micProcessorNode.connect(silentGain);
    silentGain.connect(audioContext.destination);

    this.media = {
      mediaStream,
      audioContext,
      micSourceNode,
      micProcessorNode,
      playbackContext: new AudioContext(),
    };
    this.connection = connection;
    this.nextPlaybackTime = 0;
  }

  /** Tears down the camera, mic, audio graph, and the live connection. Safe to call multiple times. */
  stop(): void {
    this.stopping = true;
    if (this.connection) {
      clearInterval(this.connection.frameIntervalId);
      try {
        this.connection.session.close();
      } catch {
        // Already closed.
      }
      this.connection = null;
    }
    if (this.media) {
      const { mediaStream, audioContext, micSourceNode, micProcessorNode, playbackContext } = this.media;
      try {
        micProcessorNode.disconnect();
        micSourceNode.disconnect();
      } catch {
        // Already disconnected.
      }
      mediaStream.getTracks().forEach((track) => track.stop());
      void audioContext.close().catch(() => {});
      void playbackContext.close().catch(() => {});
      this.media = null;
    }
    this.videoEl = null;
    this.resumptionHandle = null;
    this.setStatus("closed");
  }

  /** Mints a fresh token (carrying `resumptionHandle` forward, if any) and opens the WebSocket. Used by both `start()` and `attemptReconnect()`. */
  private async connectLive(): Promise<LiveConnection> {
    const token = await fetchLiveToken(this.crop.name, this.candidates, this.farmerContext, this.resumptionHandle ?? undefined);
    const client = new GoogleGenAI({ apiKey: token.token });

    const session: Session = await client.live.connect({
      model: token.model,
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        sessionResumption: { handle: this.resumptionHandle ?? undefined, transparent: true },
      },
      callbacks: {
        onopen: () => this.setStatus("connected"),
        onmessage: (message) => this.handleServerMessage(message),
        onerror: (event) => {
          if (this.stopping) return;
          this.setStatus("error");
          this.events.onError?.(`Live connection error: ${event.message ?? "unknown"}.`);
        },
        onclose: () => this.handleUnexpectedClose(),
      },
    });

    const videoEl = this.videoEl;
    const frameIntervalId = setInterval(() => {
      if (videoEl) this.sendVideoFrame(videoEl);
    }, VIDEO_FRAME_INTERVAL_MS);

    return { session, frameIntervalId };
  }

  /**
   * `onclose` fires both when the farmer taps "End Visit" (expected — `stop()` already set
   * `stopping`) and when Gemini or the network drops the connection unprompted (a farmer-hostile
   * surprise mid-diagnosis, and a NORMAL occurrence given the Live API's ~10-minute connection
   * lifetime). Only the latter attempts a reconnect, and only once.
   */
  private handleUnexpectedClose(): void {
    if (this.stopping) return;
    if (!this.media) return; // start() itself already failed/cleaned up — nothing to resume.
    if (this.reconnectCount >= MAX_AUTO_RECONNECTS) {
      this.setStatus("error");
      this.events.onError?.("The live connection dropped and could not be restored. Please start a new visit.");
      return;
    }

    this.reconnectCount += 1;
    this.setStatus("reconnecting");
    if (this.connection) clearInterval(this.connection.frameIntervalId);
    this.connection = null;

    this.connectLive()
      .then((connection) => {
        this.connection = connection;
      })
      .catch((err) => {
        this.setStatus("error");
        this.events.onError?.(
          err instanceof Error ? `Could not reconnect Crop Doctor: ${err.message}` : "Could not reconnect Crop Doctor."
        );
      });
  }

  private sendVideoFrame(videoEl: HTMLVideoElement): void {
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
      this.connection?.session.sendRealtimeInput({ video: { data: base64, mimeType: "image/jpeg" } });
    } catch {
      // See mic send comment — a closing socket reports itself via onerror/onclose.
    }
  }

  private handleServerMessage(message: LiveServerMessage): void {
    const resumptionUpdate = message.sessionResumptionUpdate;
    if (resumptionUpdate?.resumable && resumptionUpdate.newHandle) {
      this.resumptionHandle = resumptionUpdate.newHandle;
    }

    if (message.toolCall?.functionCalls) {
      for (const call of message.toolCall.functionCalls) {
        if (call.name !== CROP_DOCTOR_TOOL_NAME) continue;
        const result = resolvePestObservation(call.args ?? {}, this.candidates);
        this.events.onPestResolved?.(result);
        try {
          this.connection?.session.sendToolResponse({
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
    if (audioBase64 && this.media) this.playAudioChunk(audioBase64, this.media.playbackContext);
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
