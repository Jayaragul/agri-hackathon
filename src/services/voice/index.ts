/**
 * Public entry point for voice, mirroring `services/ai/index.ts`: lazy singleton, one place
 * to swap the backend. Today that's the browser's own Web Speech API; the factory is the only
 * line that needs to change to point at a teammate's dedicated voice agent instead.
 */
import { WebSpeechVoiceAgent } from "./WebSpeechVoiceAgent";
import { NullVoiceAgent } from "./NullVoiceAgent";
import type { VoiceAgentPort } from "./types";

let cachedAgent: VoiceAgentPort | null = null;

export function getVoiceAgent(): VoiceAgentPort {
  if (cachedAgent === null) {
    const webSpeech = new WebSpeechVoiceAgent();
    cachedAgent = webSpeech.isSupported() ? webSpeech : new NullVoiceAgent();
  }
  return cachedAgent;
}

export function resetVoiceAgent(): void {
  cachedAgent = null;
}

export type { VoiceAgentPort } from "./types";
export { WebSpeechVoiceAgent } from "./WebSpeechVoiceAgent";
export { NullVoiceAgent } from "./NullVoiceAgent";
export {
  parseVoiceIntent,
  executeVoiceIntent,
  type VoiceIntent,
  type VoiceCommandContext,
} from "./VoiceCommandBus";
