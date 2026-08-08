/**
 * Microphone capture for Audio Mode and the onboarding name-capture step.
 *
 * Deliberately does NOT use `MediaRecorder` — on virtually every browser that only produces
 * webm/opus (or ogg/opus), and Sarvam AI's `/speech-to-text` endpoint validates the declared
 * content-type against a strict allowlist that does not include webm (confirmed against the
 * live API: "Invalid file type: audio/webm;codecs=opus. Only ['audio/wav', 'audio/mp3', ...]").
 * Team 012's `voice` branch reference implementation worked around this by mislabeling its
 * webm/opus blob as `audio/wav` — which only avoids the error if Sarvam never actually decodes
 * the bytes it declines to validate. Instead, this captures raw PCM directly via the Web Audio
 * API (same technique as `services/ai/live/CropDoctorSession.ts`'s mic pipeline) and wraps it in
 * a genuine WAV container (`wavEncoder.ts`), so the declared type always matches the real bytes.
 *
 * Also keeps the reference implementation's voice-activity-detection idea: recording auto-stops
 * after a few seconds of silence following detected speech, so a farmer never has to find a
 * "stop" button mid-sentence.
 */
import { resampleLinear, floatTo16BitPCM } from "../ai/live/audioUtils";
import { encodeWavPcm16, bytesToBase64, concatFloat32 } from "./wavEncoder";

export interface RecordedAudio {
  base64Data: string;
  mimeType: string;
}

const TARGET_SAMPLE_RATE = 16_000; // Sarvam's recommended rate for speech-to-text.
const PROCESSOR_BUFFER_SIZE = 4_096;
const SILENCE_THRESHOLD = 15; // 0-255 average frequency-bin level below which we call it "quiet"
const SILENCE_DELAY_MS = 2_000;

export class AudioRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];

  private analyser: AnalyserNode | null = null;
  private vadFrameId: number | null = null;
  private hasSpoken = false;
  private silenceStart: number | null = null;

  /** `onSilence` fires once, at most, after speech was detected and then `SILENCE_DELAY_MS` of quiet follows — the caller decides whether that means "auto-stop." */
  async start(onSilence?: () => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });

    this.audioContext = new AudioContext();
    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
    this.processorNode = this.audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1);
    this.chunks = [];

    this.processorNode.onaudioprocess = (event) => {
      this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    };

    // A ScriptProcessorNode only fires while connected to a destination; route through a silent
    // gain so the farmer's own mic is never audibly looped back to their speakers.
    const silentGain = this.audioContext.createGain();
    silentGain.gain.value = 0;
    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(silentGain);
    silentGain.connect(this.audioContext.destination);

    if (onSilence) this.setupVoiceActivityDetection(onSilence);
  }

  private setupVoiceActivityDetection(onSilence: () => void): void {
    if (!this.audioContext || !this.sourceNode) return;
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.2;
    this.sourceNode.connect(this.analyser);

    const data = new Uint8Array(this.analyser.frequencyBinCount);

    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(data);
      const avg = data.reduce((sum, v) => sum + v, 0) / data.length;

      if (avg > SILENCE_THRESHOLD) {
        this.hasSpoken = true;
        this.silenceStart = null;
      } else if (this.hasSpoken) {
        if (this.silenceStart === null) this.silenceStart = Date.now();
        else if (Date.now() - this.silenceStart > SILENCE_DELAY_MS) {
          onSilence();
          return;
        }
      }
      this.vadFrameId = requestAnimationFrame(tick);
    };
    tick();
  }

  private cleanupVoiceActivityDetection(): void {
    if (this.vadFrameId !== null) cancelAnimationFrame(this.vadFrameId);
    this.analyser?.disconnect();
    this.vadFrameId = null;
    this.analyser = null;
    this.hasSpoken = false;
    this.silenceStart = null;
  }

  private teardownAudioGraph(): number {
    const nativeSampleRate = this.audioContext?.sampleRate ?? TARGET_SAMPLE_RATE;
    try {
      this.processorNode?.disconnect();
      this.sourceNode?.disconnect();
    } catch {
      // Already disconnected.
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.audioContext && this.audioContext.state !== "closed") void this.audioContext.close().catch(() => {});
    this.audioContext = null;
    this.processorNode = null;
    this.sourceNode = null;
    return nativeSampleRate;
  }

  stop(): Promise<RecordedAudio> {
    this.cleanupVoiceActivityDetection();
    if (!this.processorNode) return Promise.reject(new Error("Not recording."));

    const nativeSampleRate = this.teardownAudioGraph();
    const merged = concatFloat32(this.chunks);
    this.chunks = [];
    const resampled = resampleLinear(merged, nativeSampleRate, TARGET_SAMPLE_RATE);
    const pcm16 = floatTo16BitPCM(resampled);
    const wavBytes = encodeWavPcm16(pcm16, TARGET_SAMPLE_RATE);

    return Promise.resolve({ base64Data: bytesToBase64(wavBytes), mimeType: "audio/wav" });
  }

  /** Abort without producing a result — used when the farmer navigates away mid-recording. */
  cancel(): void {
    this.cleanupVoiceActivityDetection();
    this.teardownAudioGraph();
    this.chunks = [];
  }
}
