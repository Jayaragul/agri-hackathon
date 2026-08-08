import type { VoiceAgentPort } from "./types";

/** Used whenever no speech backend is available. `isSupported()` is false so the UI can show "voice coming soon" instead of a silently broken mic button. */
export class NullVoiceAgent implements VoiceAgentPort {
  public readonly id = "null";

  isSupported(): boolean {
    return false;
  }

  isListening(): boolean {
    return false;
  }

  start(_onTranscript: (text: string, isFinal: boolean) => void, onError?: (message: string) => void): void {
    onError?.("Voice input is not available on this device or browser.");
  }

  stop(): void {
    // No-op.
  }

  async speak(_text: string): Promise<void> {
    // No-op: nothing to play back.
  }
}
