import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useFarmStore } from "../state/farmStore";
import { useOnboarding } from "../features/onboarding/useOnboarding";

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

describe("useOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFarmStore.setState({ farmerName: null, onboardingComplete: false });
    mocks.getVoiceStatus.mockResolvedValue({ configured: true, languageCode: "ta-IN" });
    mocks.speak.mockResolvedValue(undefined);
    mocks.recorderStart.mockResolvedValue(undefined);
    mocks.recorderStop.mockResolvedValue({ base64Data: "abc", mimeType: "audio/wav" });
    mocks.transcribeAudio.mockResolvedValue("Meena");
  });

  it("starts on the ask-name step and resolves voice readiness", async () => {
    const { result } = renderHook(() => useOnboarding());
    expect(result.current.step).toBe("ask-name");
    await waitFor(() => expect(result.current.voiceReady).toBe(true));
  });

  it("typing a name and confirming persists it, speaks a greeting, and moves to choose-mode", async () => {
    const { result } = renderHook(() => useOnboarding());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));

    act(() => result.current.setNameDraft("Surya"));
    act(() => result.current.confirmName());

    expect(result.current.step).toBe("choose-mode");
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
    expect(result.current.step).toBe("choose-mode");

    act(() => result.current.retryName());
    expect(result.current.step).toBe("ask-name");
  });
});
