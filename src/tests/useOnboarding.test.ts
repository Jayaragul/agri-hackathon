import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useFarmStore } from "../state/farmStore";
import { useOnboarding } from "../features/onboarding/useOnboarding";
import { clearTimelineEvents } from "../services/timeline/farmTimeline";
import { clearLabReport } from "../services/identity/labReport";

const mocks = vi.hoisted(() => {
  class MockVoiceProxyError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = "VoiceProxyError";
    }
  }
  return {
    MockVoiceProxyError,
    getVoiceStatus: vi.fn(),
    transcribeAudio: vi.fn(),
    speak: vi.fn(),
    recorderStart: vi.fn(),
    recorderStop: vi.fn(),
    recorderCancel: vi.fn(),
    dispatch: vi.fn(),
    fileToInlineImage: vi.fn(),
  };
});

vi.mock("../services/voice/sarvamClient", () => ({
  getVoiceStatus: mocks.getVoiceStatus,
  transcribeAudio: mocks.transcribeAudio,
  VoiceProxyError: mocks.MockVoiceProxyError,
}));

vi.mock("../services/voice/speak", () => ({
  speak: mocks.speak,
}));

vi.mock("../services/voice/AudioRecorder", () => ({
  AudioRecorder: vi.fn().mockImplementation(() => ({
    start: mocks.recorderStart,
    stop: mocks.recorderStop,
    cancel: mocks.recorderCancel,
  })),
}));

vi.mock("../services/ai/a2a", () => ({
  getA2AOrchestrator: () => ({ dispatch: mocks.dispatch }),
}));

vi.mock("../services/ai/providers/GeminiSoilReportExtractor", () => ({
  fileToInlineImage: mocks.fileToInlineImage,
}));

describe("useOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clearTimelineEvents();
    clearLabReport();
    useFarmStore.setState({ farmerName: null, onboardingComplete: false, labReport: null, timelineEvents: [] });
    mocks.getVoiceStatus.mockResolvedValue({ configured: true, languageCode: "ta-IN" });
    mocks.speak.mockResolvedValue(undefined);
    mocks.recorderStart.mockResolvedValue(undefined);
    mocks.recorderStop.mockResolvedValue({ base64Data: "abc", mimeType: "audio/wav" });
    mocks.transcribeAudio.mockResolvedValue("Meena");
    mocks.fileToInlineImage.mockResolvedValue({ mimeType: "image/jpeg", base64Data: "abc123" });
  });

  it("starts on the ask-name step and resolves voice readiness", async () => {
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.step).toBe("ask-name");
    await waitFor(() => expect(result.current.voiceReady).toBe(true));
  });

  it("typing a name and confirming persists it, speaks a greeting, and moves to upload-report", async () => {
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));

    act(() => result.current.setNameDraft("Surya"));
    act(() => result.current.confirmName());

    expect(result.current.step).toBe("upload-report");
    expect(useFarmStore.getState().farmerName).toBe("Surya");
    await waitFor(() => expect(mocks.speak).toHaveBeenCalledOnce());
    expect(mocks.speak.mock.calls[0][0]).toContain("Surya");
  });

  it("does nothing for a blank or whitespace-only name", async () => {
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));
    act(() => result.current.setNameDraft("   "));
    act(() => result.current.confirmName());
    expect(result.current.step).toBe("ask-name");
    expect(useFarmStore.getState().farmerName).toBeNull();
  });

  it("recording, stopping, and transcribing moves to confirm-name with the transcript as the draft", async () => {
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));

    act(() => result.current.startRecording());
    await waitFor(() => expect(result.current.isRecording).toBe(true));
    expect(mocks.recorderStart).toHaveBeenCalledOnce();

    act(() => result.current.stopRecording());
    await waitFor(() => expect(result.current.step).toBe("confirm-name"));
    expect(result.current.nameDraft).toBe("Meena");
    expect(result.current.isRecording).toBe(false);
    expect(result.current.isProcessing).toBe(false);
  });

  it("surfaces a clear message when microphone access is denied", async () => {
    mocks.recorderStart.mockRejectedValue(new Error("Permission denied"));
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));

    act(() => result.current.startRecording());
    await waitFor(() => expect(result.current.error).toContain("Microphone access was denied"));
    expect(result.current.isRecording).toBe(false);
  });

  it("surfaces a clear message when transcription fails", async () => {
    mocks.transcribeAudio.mockRejectedValue(new mocks.MockVoiceProxyError(503, "Sarvam is not configured on the server."));
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));

    act(() => result.current.startRecording());
    await waitFor(() => expect(result.current.isRecording).toBe(true));
    act(() => result.current.stopRecording());

    await waitFor(() => expect(result.current.error).toBe("Sarvam is not configured on the server."));
    expect(result.current.step).toBe("ask-name");
  });

  it("retryName returns to the ask-name step", async () => {
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));
    act(() => result.current.setNameDraft("Kumar"));
    act(() => result.current.confirmName());
    expect(result.current.step).toBe("upload-report");

    act(() => result.current.retryName());
    expect(result.current.step).toBe("ask-name");
  });

  describe("upload-report step", () => {
    const fakeFile = new File(["fake-bytes"], "report.jpg", { type: "image/jpeg" });

    async function advanceToUploadStep(result: { current: ReturnType<typeof useOnboarding> }) {
      await waitFor(() => expect(result.current.voiceReady).toBe(true));
      act(() => result.current.setNameDraft("Surya"));
      act(() => result.current.confirmName());
      expect(result.current.step).toBe("upload-report");
    }

    it("stores a recognised extraction, logs a timeline event, and reports success", async () => {
      mocks.dispatch.mockResolvedValue({
        data: {
          ph: 6.5,
          nitrogenKgPerAcre: 80,
          phosphorusKgPerAcre: 40,
          potassiumKgPerAcre: 40,
          documentRecognised: true,
          confidence: "high",
          warnings: [],
        },
        source: "gemini",
      });

      const { result } = renderHook(() => useOnboarding());
      await advanceToUploadStep(result);

      act(() => result.current.uploadReport(fakeFile));
      await waitFor(() => expect(result.current.uploadStatus).toBe("success"));

      expect(useFarmStore.getState().labReport).toMatchObject({ ph: 6.5, nitrogenKgPerAcre: 80 });
      const events = useFarmStore.getState().timelineEvents;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: "lab-report", source: "agent" });
      expect(result.current.step).toBe("upload-report"); // stays put until continueAfterUpload

      act(() => result.current.continueAfterUpload());
      expect(result.current.step).toBe("choose-mode");
    });

    it("surfaces an error and never stores a reading when the document is not recognised", async () => {
      mocks.dispatch.mockResolvedValue({
        data: {
          ph: null,
          nitrogenKgPerAcre: null,
          phosphorusKgPerAcre: null,
          potassiumKgPerAcre: null,
          documentRecognised: false,
          confidence: "low",
          warnings: ["The photo was too blurry to read."],
        },
        source: "gemini",
      });

      const { result } = renderHook(() => useOnboarding());
      await advanceToUploadStep(result);

      act(() => result.current.uploadReport(fakeFile));
      await waitFor(() => expect(result.current.uploadStatus).toBe("error"));

      expect(result.current.uploadMessage).toBe("The photo was too blurry to read.");
      expect(useFarmStore.getState().labReport).toBeNull();
      expect(useFarmStore.getState().timelineEvents).toHaveLength(0);
    });

    it("surfaces a generic error when the file itself cannot be read", async () => {
      mocks.fileToInlineImage.mockRejectedValue(new Error("bad file"));
      const { result } = renderHook(() => useOnboarding());
      await advanceToUploadStep(result);

      act(() => result.current.uploadReport(fakeFile));
      await waitFor(() => expect(result.current.uploadStatus).toBe("error"));

      expect(result.current.uploadMessage).toBe("Could not read that file. Please try another photo, or skip for now.");
    });

    it("skipUpload moves straight to choose-mode without touching labReport", async () => {
      const { result } = renderHook(() => useOnboarding());
      await advanceToUploadStep(result);

      act(() => result.current.skipUpload());

      expect(result.current.step).toBe("choose-mode");
      expect(useFarmStore.getState().labReport).toBeNull();
      expect(mocks.dispatch).not.toHaveBeenCalled();
    });
  });
});
