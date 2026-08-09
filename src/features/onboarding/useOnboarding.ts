import { useEffect, useRef, useState } from "react";
import { useFarmStore } from "../../state/farmStore";
import { AudioRecorder } from "../../services/voice/AudioRecorder";
import { getVoiceStatus, transcribeAudio, VoiceProxyError } from "../../services/voice/sarvamClient";
import { speak } from "../../services/voice/speak";
import { getA2AOrchestrator } from "../../services/ai/a2a";
import type { SoilReportExtraction } from "../../services/ai/contracts/aiSchemas";
import { fileToInlineImage } from "../../services/ai/providers/GeminiSoilReportExtractor";
import { getSessionId } from "../../services/session/sessionId";
import { persistSoilReport } from "../../services/soilReport/soilReportClient";

/**
 * All of the first-run flow's logic, with no rendering in it — mirrors `useVoiceConversation.ts`'s
 * split for the same reason: `OnboardingGate.tsx` should only have to answer "how does this
 * look," and this hook is independently unit-testable without mounting the DOM tree. The
 * mode-choice step itself has no logic of its own (it's just two buttons calling the
 * `onModeChosen` prop the component already receives), so it stays out of this hook.
 *
 * Step order is deliberate: name, THEN a soil report upload, THEN mode choice — a farmer's soil
 * numbers land in `labReport` (`services/identity/labReport.ts`) before they ever reach a
 * recommendation or advisor screen, so every later feature already has real data to work with
 * instead of empty wizard fields. Uploading is strongly the expected path, not a hard requirement
 * that could brick onboarding if a farmer has no photo handy or Gemini is briefly unavailable —
 * `skipUpload()` is the deliberately de-emphasized escape hatch, same graceful-degradation
 * posture as every other AI-backed feature in this app.
 */

export type OnboardingStep = "ask-name" | "confirm-name" | "upload-report" | "choose-mode";

export type ReportUploadStatus = "idle" | "uploading" | "success" | "error";

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
  uploadStatus: ReportUploadStatus;
  uploadMessage: string | null;
  uploadReport: (file: File) => void;
  skipUpload: () => void;
  continueAfterUpload: () => void;
}

const SILENCE_EVENT = "onboarding-silence-detected";

export function useOnboarding(): OnboardingState {
  const setFarmerName = useFarmStore((s) => s.setFarmerName);
  const setLabReport = useFarmStore((s) => s.setLabReport);
  const logTimelineEvent = useFarmStore((s) => s.logTimelineEvent);
  const [step, setStep] = useState<OnboardingStep>("ask-name");
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<ReportUploadStatus>("idle");
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
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
    void speak(`Vanakkam, ${trimmed}! Let's start with your soil report.`);
    setStep("upload-report");
  };

  const retryName = (): void => setStep("ask-name");

  /**
   * Same `extract-soil-report` A2A skill Audio Mode's `uploadLabReport` uses (see
   * `useVoiceConversation.ts`) — consistent telemetry/retry behaviour, and it means this call
   * shows up in the AI Agent Trace panel like every other AI-backed action in the app. There is
   * never a `profile` yet at this point in the flow (onboarding always runs first), so this is
   * simpler than the Audio Mode version: it only ever needs to populate `labReport`, never merge
   * into an existing profile.
   */
  const uploadReport = (file: File): void => {
    setUploadStatus("uploading");
    setUploadMessage(null);
    void (async () => {
      try {
        const image = await fileToInlineImage(file);
        const outcome = await getA2AOrchestrator().dispatch<SoilReportExtraction>("extract-soil-report", { image });

        if (!outcome.data.documentRecognised) {
          setUploadStatus("error");
          setUploadMessage(outcome.data.warnings[0] || "That didn't look like a soil report. Try another photo, or skip and enter values by hand later.");
          return;
        }

        setLabReport(outcome.data);

        // Best-effort durable copy — see `soilReportClient.ts`'s header. Fire-and-forget: the
        // reading is already applied locally via `setLabReport` above.
        void persistSoilReport({
          sessionId: getSessionId(),
          fileName: file.name || "lab-report",
          image,
          extraction: outcome.data,
        });

        const readings = [
          outcome.data.ph !== null ? `pH ${outcome.data.ph}` : null,
          outcome.data.nitrogenKgPerAcre !== null ? `N ${outcome.data.nitrogenKgPerAcre}` : null,
          outcome.data.phosphorusKgPerAcre !== null ? `P ${outcome.data.phosphorusKgPerAcre}` : null,
          outcome.data.potassiumKgPerAcre !== null ? `K ${outcome.data.potassiumKgPerAcre}` : null,
        ].filter((v): v is string => v !== null);

        logTimelineEvent({
          mode: "reactive",
          kind: "lab-report",
          source: "agent",
          title: "Lab report added during onboarding",
          detail: readings.length > 0 ? `Read from photo: ${readings.join(", ")} kg/acre.` : "Photo uploaded, but no values were legible.",
          cropId: null,
        });

        setUploadStatus("success");
        setUploadMessage(readings.length > 0 ? `Got it — ${readings.join(", ")} kg/acre.` : "Photo received, but no values were legible yet. You can enter them by hand later.");
      } catch {
        setUploadStatus("error");
        setUploadMessage("Could not read that file. Please try another photo, or skip for now.");
      }
    })();
  };

  const skipUpload = (): void => setStep("choose-mode");
  const continueAfterUpload = (): void => setStep("choose-mode");

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
    uploadStatus,
    uploadMessage,
    uploadReport,
    skipUpload,
    continueAfterUpload,
  };
}
