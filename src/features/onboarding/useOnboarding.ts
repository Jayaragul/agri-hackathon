import { useEffect, useRef, useState } from "react";
import { useFarmStore } from "../../state/farmStore";
import { AudioRecorder } from "../../services/voice/AudioRecorder";
import { getVoiceStatus, transcribeAudio, VoiceProxyError } from "../../services/voice/sarvamClient";
import { speak } from "../../services/voice/speak";

/**
 * All of the first-run name-capture flow's logic, with no rendering in it — mirrors
 * `useVoiceConversation.ts`'s split for the same reason: `OnboardingGate.tsx` should only have
 * to answer "how does this look," and this hook is independently unit-testable without mounting
 * the DOM tree. The mode-choice step itself has no logic of its own (it's just two buttons
 * calling the `onModeChosen` prop the component already receives), so it stays out of this hook.
 */

export type OnboardingStep = "ask-name" | "confirm-name" | "choose-mode";

export interface OnboardingState {
  step: OnboardingStep;
  voiceReady: boolean | null;
  isRecording: boolean;
  isProcessing: boolean;
  nameDraft: string;
  setNameDraft: (value: string) => void;
  error: string | null;
  startRecording: () => void;
  stopRecording: () => void;
  confirmName: () => void;
  retryName: () => void;
}

const SILENCE_EVENT = "onboarding-silence-detected";

export function useOnboarding(): OnboardingState {
  const setFarmerName = useFarmStore((s) => s.setFarmerName);
  const [step, setStep] = useState<OnboardingStep>("ask-name");
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVoiceStatus().then((status) => {
      if (!cancelled) setVoiceReady(status.configured);
    });
    return () => {
      cancelled = true;
      recorderRef.current?.cancel();
    };
  }, []);

  const startRecording = async (): Promise<void> => {
    setError(null);
    setIsRecording(true);
    const recorder = new AudioRecorder();
    recorderRef.current = recorder;
    try {
      await recorder.start(() => document.dispatchEvent(new CustomEvent(SILENCE_EVENT)));
    } catch {
      setIsRecording(false);
      setError("Microphone access was denied — you can type your name instead.");
    }
  };

  const stopRecording = async (): Promise<void> => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setIsRecording(false);
    setIsProcessing(true);
    try {
      const { base64Data, mimeType } = await recorder.stop();
      const transcript = await transcribeAudio(base64Data, mimeType);
      setNameDraft(transcript.trim());
      setStep("confirm-name");
    } catch (err) {
      setError(err instanceof VoiceProxyError ? err.message : "Could not hear that clearly — please type your name instead.");
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    const handler = () => {
      if (recorderRef.current) void stopRecording();
    };
    document.addEventListener(SILENCE_EVENT, handler);
    return () => document.removeEventListener(SILENCE_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmName = (): void => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setFarmerName(trimmed);
    void speak(`Vanakkam, ${trimmed}! Would you like Audio mode or Video mode?`);
    setStep("choose-mode");
  };

  const retryName = (): void => setStep("ask-name");

  return {
    step,
    voiceReady,
    isRecording,
    isProcessing,
    nameDraft,
    setNameDraft,
    error,
    startRecording: () => void startRecording(),
    stopRecording: () => void stopRecording(),
    confirmName,
    retryName,
  };
}
