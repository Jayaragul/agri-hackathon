/**
 * The one seam a voice agent implements — swap `WebSpeechVoiceAgent` for a dedicated
 * hosted/streaming agent later (see project memory: a teammate is building one) without
 * touching `VoiceCommandBus` or `VoiceControlWidget`. Mirrors the shape of `AiTransport` in
 * `services/ai/contracts/aiTypes.ts`: one interface, swappable implementations, a `Null`
 * fallback so the feature degrades instead of crashing when nothing is available.
 */
export interface VoiceAgentPort {
  readonly id: string;
  /** Cheap synchronous capability check — no permissions prompt, no network call. */
  isSupported(): boolean;
  isListening(): boolean;
  /** Begin listening for one utterance. `onTranscript` may fire more than once (interim results) before the final call. */
  start(onTranscript: (text: string, isFinal: boolean) => void, onError?: (message: string) => void): void;
  stop(): void;
  /** Speak `text` aloud; resolves once playback ends (or immediately if speech synthesis is unavailable). */
  speak(text: string): Promise<void>;
}
