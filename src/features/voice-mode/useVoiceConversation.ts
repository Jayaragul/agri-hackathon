import { useEffect, useRef, useState } from "react";
import { useFarmStore } from "../../state/farmStore";
import { getA2AOrchestrator } from "../../services/ai/a2a";
import type { FarmAdvisorAnswer } from "../../services/ai";
import type { SoilReportExtraction } from "../../services/ai/contracts/aiSchemas";
import { fileToInlineImage } from "../../services/ai/providers/GeminiSoilReportExtractor";
import { getSessionStorage } from "../../services/storage";
import type { ChatMessage } from "../../services/storage";
import { getSessionId } from "../../services/session/sessionId";
import { getLatestSoilReport, persistSoilReport } from "../../services/soilReport/soilReportClient";
import { getLabReport } from "../../services/identity/labReport";
import { recallMemories, recordMemory } from "../../services/memory/memoryClient";
import { AudioRecorder } from "../../services/voice/AudioRecorder";
import { getVoiceStatus, transcribeAudio, VoiceProxyError } from "../../services/voice/sarvamClient";
import { speak } from "../../services/voice/speak";
import { getFarmContextSnapshot } from "../../services/context/farmContext";
import { describeProactiveAlert } from "../../engine/proactiveEngine";
import { getWeatherProactiveAlerts } from "../../services/weather/weatherContext";
import { describeFarmAdvisorToolCall, runFarmAdvisorToolLoop } from "../../services/ai/runtime/farmAdvisorTools";

/**
 * All of Audio Mode's conversation logic, with no rendering in it — the state machine, the
 * mic/recording lifecycle, and the shared `askQuestion()` path both speech and typed input feed
 * into. `VoiceMode.tsx` is a thin view over this hook's return value; separating them means the
 * conversation logic is unit-testable in isolation (see `useVoiceConversation.test.ts`) without
 * mounting the DOM tree, and the component file only has to answer "how does this look," never
 * "what does a farmer's question actually do."
 *
 * The "brain" is the SAME `answer-farm-question` A2A skill the typed Farm Advisor calls — same
 * knowledge-base grounding, same mem0 memory, same harness logging, same safety boundary. This
 * hook only adds a speech I/O layer on top of infrastructure that already exists. See
 * [[krishi-mitra-ai-boundary]].
 */

export type VoiceConversationPhase = "idle" | "recording" | "transcribing" | "thinking" | "speaking" | "error";

export type LabReportUploadStatus = "idle" | "uploading" | "success" | "error";

export const PHASE_LABEL: Record<VoiceConversationPhase, string> = {
  idle: "push to speak",
  recording: "listening… stops when you go quiet",
  transcribing: "understanding…",
  thinking: "thinking…",
  speaking: "speaking…",
  error: "something went wrong",
};

const SILENCE_EVENT = "voice-mode-silence-detected";

export interface VoiceConversationState {
  phase: VoiceConversationPhase;
  busy: boolean;
  voiceReady: boolean | null;
  errorMessage: string | null;
  greetingLine: string;
  answerText: string;
  /** Full transcript, oldest first — powers the redesigned scrollable message list. */
  messages: ChatMessage[];
  /** "Remembered: …" / "Checked: …" chips for the most recent turn — `[]` when nothing beyond the base context was used. */
  lastActivity: string[];
  typedQuestion: string;
  setTypedQuestion: (value: string) => void;
  handleMicClick: () => void;
  handleSend: () => void;
  uploadLabReport: (file: File) => Promise<void>;
  labReportStatus: LabReportUploadStatus;
  labReportMessage: string | null;
}

export function useVoiceConversation(): VoiceConversationState {
  const {
    profile,
    selectedCrop,
    recommendations,
    farmerName,
    declaredSituation,
    setDeclaredSituation,
    setLabReport,
    logTimelineEvent,
  } = useFarmStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [phase, setPhase] = useState<VoiceConversationPhase>("idle");
  const [voiceReady, setVoiceReady] = useState<boolean | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [typedQuestion, setTypedQuestion] = useState("");
  const [labReportStatus, setLabReportStatus] = useState<LabReportUploadStatus>("idle");
  const [labReportMessage, setLabReportMessage] = useState<string | null>(null);
  const [lastActivity, setLastActivity] = useState<string[]>([]);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const hasGreeted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getVoiceStatus().then((status) => {
      if (!cancelled) setVoiceReady(status.configured);
    });
    getSessionStorage()
      .loadAdvisorMessages()
      .then(async (history) => {
        if (cancelled) return;
        setMessages(history);
        if (history.length === 0 && !hasGreeted.current) {
          hasGreeted.current = true;
          const name = farmerName ? `வணக்கம், ${farmerName}!` : "வணக்கம்!";
          // A farmer who never walks the profile wizard (Audio Mode is the default landing
          // screen, so that may be most farmers) otherwise gets nothing but generic answers
          // forever — asking this up front is what makes `declaredSituation` ever get set.
          // Proactive: when the deterministic calendar or the weather forecast has already
          // computed something worth flagging (a milestone, a newly-opening pest-risk window, a
          // heavy-rain warning), lead with it here — the one place every farmer, audio-only or
          // not, is guaranteed to hear it. Weather only resolves once `profile.region` is known
          // (the wizard, or nothing yet — `getWeatherProactiveAlerts` returns `[]` either way).
          // NOTE: `describeProactiveAlert` itself still returns English (it's shared with visual
          // UI chips elsewhere) — the surrounding phrase is Tamil, this one embedded clause is a
          // known, scoped exception, not an oversight.
          const weatherAlerts = await getWeatherProactiveAlerts(profile?.region);
          const nearestAlert = [...getFarmContextSnapshot().upcomingAlerts, ...weatherAlerts][0];
          if (cancelled) return;
          const headsUp = nearestAlert ? ` குறிப்பு — ${describeProactiveAlert(nearestAlert)}.` : "";
          const greeting = declaredSituation
            ? `${name} நான் துளிர்.${headsUp} பேச பொத்தானை அழுத்தவும், அல்லது கீழே தட்டச்சு செய்யவும் — உங்கள் பண்ணையைப் பற்றி எதுவும் கேளுங்கள்.`
            : `${name} நான் துளிர்.${headsUp} சிறந்த பதில் தர, நீங்கள் என்ன பயிர் செய்கிறீர்கள், உங்கள் பண்ணை எங்கே உள்ளது என்று சொல்லுங்கள் — அல்லது எதுவும் கேளுங்கள்.`;
          void speak(greeting);
        }
      })
      .catch(() => {});

    // Cross-device restore: `labReport` (services/identity/labReport.ts) is `localStorage`-scoped
    // to one browser. If this device has never captured one locally, check whether an earlier
    // upload from a DIFFERENT device already durably saved one for this session id
    // (server/src/routes/soilReportRoutes.ts). A no-op when a local reading already exists, when
    // no backend is deployed, or when nothing has ever been uploaded — never overwrites a local
    // reading that's already there.
    if (!getLabReport()) {
      getLatestSoilReport(getSessionId())
        .then((extraction) => {
          if (!cancelled && extraction) setLabReport(extraction);
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      recorderRef.current?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The answer (storage/dispatch/memory) and the spoken narration are deliberately in separate
   * try blocks: the answer is the thing that can actually fail and needs to surface as an error;
   * `speak()` never throws — a farmer should still see (and have on record) a correct answer even
   * if Sarvam's TTS hiccups on the narration.
   */
  const askQuestion = async (question: string): Promise<void> => {
    const trimmed = question.trim();
    if (!trimmed) {
      setPhase("idle");
      return;
    }

    // Opportunistic, one-time capture: a farmer who never walks the profile wizard otherwise
    // has NO farm context at all beyond their name. The first thing they say that reads like an
    // actual statement (not "hi") becomes the fallback context every agent in the app can use —
    // see `services/identity/farmerIdentity.ts`'s `declaredSituation`. Never overwrites a value
    // that's already there, and never claims engine authority (it's relayed verbatim, labelled
    // "farmer-reported, not verified" everywhere it's used).
    const isSubstantial = trimmed.length >= 15 && trimmed.split(/\s+/).length >= 3;
    const effectiveDeclaredSituation = declaredSituation || (isSubstantial ? trimmed : null);
    if (!declaredSituation && isSubstantial) setDeclaredSituation(trimmed);

    // Captured BEFORE this message is logged below, so "recent events" reflects history prior
    // to this question — never the question echoing itself back as its own context.
    const { recentEvents, upcomingAlerts } = getFarmContextSnapshot();

    // Reactive: a farmer statement substantial enough to be worth remembering as their declared
    // situation is also substantial enough to be worth a line in the shared farm timeline — see
    // `services/timeline/farmTimeline.ts`. Every agent reads this back through `farmContext.ts`.
    if (isSubstantial) {
      logTimelineEvent({
        mode: "reactive",
        kind: "observation",
        source: "farmer",
        title: trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed,
        detail: trimmed,
        cropId: selectedCrop?.id ?? null,
      });
    }

    let answer: string;
    try {
      const storage = getSessionStorage();
      const afterFarmer = await storage.appendAdvisorMessage({ role: "farmer", text: trimmed });
      setMessages(afterFarmer);
      void recordMemory("farmer", trimmed);

      setPhase("thinking");
      const topRecommendation = recommendations[0] ?? null;
      const memories = await recallMemories(trimmed);
      const weatherAlerts = await getWeatherProactiveAlerts(profile?.region);
      const toolLoop = await runFarmAdvisorToolLoop(trimmed, {
        crop: selectedCrop ?? null,
        profile: profile ?? null,
        topRecommendation,
        farmerName,
      });
      const outcome = await getA2AOrchestrator().dispatch<FarmAdvisorAnswer>("answer-farm-question", {
        question: trimmed,
        profile: profile ?? null,
        crop: selectedCrop ?? null,
        topRecommendation,
        memories,
        farmerName,
        declaredSituation: effectiveDeclaredSituation,
        recentEvents: recentEvents.map((e) => e.title),
        upcomingAlerts: [...upcomingAlerts, ...weatherAlerts].map(describeProactiveAlert),
        liveToolResults: toolLoop.toolContextLines,
        spokenStyle: true,
      });

      const activity: string[] = [];
      if (memories.length > 0) activity.push(`Remembered ${memories.length} earlier note${memories.length > 1 ? "s" : ""}`);
      for (const record of toolLoop.toolCallRecords) activity.push(describeFarmAdvisorToolCall(record));
      setLastActivity(activity);

      const afterAssistant = await storage.appendAdvisorMessage({
        role: "assistant",
        text: outcome.data.answer,
        citedFacts: outcome.data.topics,
        source: outcome.source,
      });
      setMessages(afterAssistant);
      void recordMemory("assistant", outcome.data.answer);
      answer = outcome.data.answer;
    } catch (err) {
      setPhase("error");
      setErrorMessage(err instanceof VoiceProxyError ? err.message : "That did not go through — please try again.");
      return;
    }

    setPhase("speaking");
    await speak(answer);
    setPhase("idle");
  };

  /**
   * Lets a farmer ground the conversation in a real soil test without ever opening the profile
   * wizard — "logged in, give details, and just speak." Reuses the SAME `extract-soil-report`
   * A2A skill the wizard's photo-upload path would use (see `GeminiSoilReportExtractor.ts`); the
   * reading is stored independently of `profile` (`services/identity/labReport.ts`) and folded
   * into every agent's context via `farmContext.ts`. Never touches the deterministic engine
   * directly — a farmer who later walks the wizard still sees these numbers as editable fields,
   * not a silently-applied recommendation.
   */
  const uploadLabReport = async (file: File): Promise<void> => {
    setLabReportStatus("uploading");
    setLabReportMessage(null);
    try {
      const image = await fileToInlineImage(file);
      const outcome = await getA2AOrchestrator().dispatch<SoilReportExtraction>("extract-soil-report", { image });

      if (!outcome.data.documentRecognised) {
        setLabReportStatus("error");
        setLabReportMessage(
          outcome.data.warnings[0] || "That didn't look like a soil report. Try another photo, or enter values by hand later."
        );
        return;
      }

      setLabReport(outcome.data);

      // Best-effort durable copy (Cloud Storage for the file, Firestore for the reading) — see
      // `soilReportClient.ts`'s header. Fire-and-forget: the farmer's reading is ALREADY applied
      // locally via `setLabReport` above, so this never blocks or can fail the visible upload.
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
        title: "Lab report added",
        detail:
          readings.length > 0
            ? `Read from photo: ${readings.join(", ")} kg/acre.`
            : "Photo uploaded, but no values were legible.",
        cropId: selectedCrop?.id ?? null,
      });

      setLabReportStatus("success");
      setLabReportMessage(
        readings.length > 0
          ? `Got it — ${readings.join(", ")} kg/acre.`
          : "Photo received, but no values were legible yet. You can enter them by hand later."
      );
    } catch {
      setLabReportStatus("error");
      setLabReportMessage("Could not read that file. Please try another photo.");
    }
  };

  const startRecording = async (): Promise<void> => {
    setErrorMessage(null);
    const recorder = new AudioRecorder();
    recorderRef.current = recorder;
    try {
      await recorder.start(() => document.dispatchEvent(new CustomEvent(SILENCE_EVENT)));
      setPhase("recording");
    } catch {
      setPhase("error");
      setErrorMessage("Microphone access was denied. Enable it in your browser settings, or type your question below.");
    }
  };

  const stopRecording = async (): Promise<void> => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    try {
      setPhase("transcribing");
      const { base64Data, mimeType } = await recorder.stop();
      const transcript = await transcribeAudio(base64Data, mimeType);
      await askQuestion(transcript);
    } catch (err) {
      setPhase("error");
      setErrorMessage(err instanceof VoiceProxyError ? err.message : "That did not go through — please try again.");
    }
  };

  useEffect(() => {
    const handler = () => {
      if (recorderRef.current && phase === "recording") void stopRecording();
    };
    document.addEventListener(SILENCE_EVENT, handler);
    return () => document.removeEventListener(SILENCE_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const busy = phase === "transcribing" || phase === "thinking" || phase === "speaking";

  const handleMicClick = (): void => {
    if (phase === "recording") void stopRecording();
    else if (phase === "idle" || phase === "error") void startRecording();
  };

  const handleSend = (): void => {
    if (!typedQuestion.trim() || busy) return;
    setErrorMessage(null);
    const question = typedQuestion;
    setTypedQuestion("");
    setPhase("thinking");
    void askQuestion(question);
  };

  const lastAssistantMessage = [...messages].reverse().find((m) => m.role === "assistant");
  const greetingLine = farmerName ? `Vanakkam, ${farmerName}` : "Vanakkam";
  const answerText = lastAssistantMessage?.text ?? (phase === "idle" ? "Ask me anything about your farm." : "");

  return {
    phase,
    busy,
    voiceReady,
    errorMessage,
    greetingLine,
    answerText,
    messages,
    lastActivity,
    typedQuestion,
    setTypedQuestion,
    handleMicClick,
    handleSend,
    uploadLabReport,
    labReportStatus,
    labReportMessage,
  };
}
