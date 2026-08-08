/**
 * Real, working voice implementation using the browser's built-in Web Speech API
 * (SpeechRecognition + speechSynthesis) — zero dependencies, zero backend, works today.
 *
 * This is the reference/default implementation behind `VoiceAgentPort`. It is intentionally
 * disposable: when the dedicated voice agent a teammate is building is ready, it becomes a
 * second `VoiceAgentPort` implementation and `services/voice/index.ts` picks between them —
 * `VoiceCommandBus` and the UI widget do not change.
 *
 * Chrome/Edge on desktop and Android support `SpeechRecognition` under the `webkit` prefix;
 * Firefox and Safari currently do not, so `isSupported()` is the UI's cue to hide the mic
 * button rather than offer a control that silently fails.
 */
import type { VoiceAgentPort } from "./types";

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function hasSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** India-locale English by default; a Tamil-speaking farmer's own agent can override the locale entirely. */
const DEFAULT_LANG = "en-IN";

export class WebSpeechVoiceAgent implements VoiceAgentPort {
  public readonly id = "web-speech";
  private recognition: SpeechRecognitionLike | null = null;
  private listening = false;

  isSupported(): boolean {
    return typeof window !== "undefined" && getRecognitionCtor() !== null;
  }

  isListening(): boolean {
    return this.listening;
  }

  start(onTranscript: (text: string, isFinal: boolean) => void, onError?: (message: string) => void): void {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      onError?.("Voice input is not supported in this browser.");
      return;
    }

    this.stop();
    const recognition = new Ctor();
    recognition.lang = DEFAULT_LANG;
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (transcript.trim().length > 0) onTranscript(transcript.trim(), result.isFinal);
      }
    };
    recognition.onerror = (event) => {
      this.listening = false;
      onError?.(`Voice recognition error: ${event.error ?? "unknown"}.`);
    };
    recognition.onend = () => {
      this.listening = false;
    };

    this.recognition = recognition;
    this.listening = true;
    try {
      recognition.start();
    } catch (err) {
      this.listening = false;
      onError?.(err instanceof Error ? err.message : "Could not start voice recognition.");
    }
  }

  stop(): void {
    this.listening = false;
    try {
      this.recognition?.stop();
    } catch {
      // Already stopped.
    }
    this.recognition = null;
  }

  speak(text: string): Promise<void> {
    if (!hasSpeechSynthesis() || typeof text !== "string" || text.trim().length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = DEFAULT_LANG;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    });
  }
}
