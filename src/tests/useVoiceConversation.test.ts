import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useFarmStore } from "../state/farmStore";
import { useVoiceConversation } from "../features/voice-mode/useVoiceConversation";
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
    loadAdvisorMessages: vi.fn(),
    appendAdvisorMessage: vi.fn(),
    recallMemories: vi.fn(),
    recordMemory: vi.fn(),
    dispatch: vi.fn(),
    recorderStart: vi.fn(),
    recorderStop: vi.fn(),
    recorderCancel: vi.fn(),
    fileToInlineImage: vi.fn(),
    getWeatherProactiveAlerts: vi.fn(),
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

vi.mock("../services/storage", () => ({
  getSessionStorage: () => ({
    loadAdvisorMessages: mocks.loadAdvisorMessages,
    appendAdvisorMessage: mocks.appendAdvisorMessage,
  }),
}));

vi.mock("../services/memory/memoryClient", () => ({
  recallMemories: mocks.recallMemories,
  recordMemory: mocks.recordMemory,
}));

vi.mock("../services/ai/a2a", () => ({
  getA2AOrchestrator: () => ({ dispatch: mocks.dispatch }),
}));

vi.mock("../services/ai/providers/GeminiSoilReportExtractor", () => ({
  fileToInlineImage: mocks.fileToInlineImage,
}));

vi.mock("../services/weather/weatherContext", () => ({
  getWeatherProactiveAlerts: mocks.getWeatherProactiveAlerts,
}));

const TIMESTAMP = "2026-01-01T00:00:00.000Z";

describe("useVoiceConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // `farmStore`'s logTimelineEvent/setLabReport actions re-derive from these services' own
    // module-level caches, not just the store snapshot below — clearing localStorage alone
    // leaves a previous test's in-memory cache in place and events leak across tests.
    clearTimelineEvents();
    clearLabReport();
    useFarmStore.setState({
      farmerName: "Meena",
      profile: null,
      selectedCrop: null,
      recommendations: [],
      declaredSituation: null,
      labReport: null,
      timelineEvents: [],
    });
    mocks.getVoiceStatus.mockResolvedValue({ configured: true, languageCode: "ta-IN" });
    mocks.loadAdvisorMessages.mockResolvedValue([]);
    mocks.appendAdvisorMessage.mockImplementation(async (m) => [{ ...m, timestamp: TIMESTAMP }]);
    mocks.recallMemories.mockResolvedValue([]);
    mocks.recordMemory.mockResolvedValue(undefined);
    mocks.speak.mockResolvedValue(undefined);
    mocks.dispatch.mockResolvedValue({ data: { answer: "Sow now.", topics: ["sowing"] }, source: "local" });
    mocks.recorderStart.mockResolvedValue(undefined);
    mocks.recorderStop.mockResolvedValue({ base64Data: "abc", mimeType: "audio/wav" });
    mocks.transcribeAudio.mockResolvedValue("When should I sow?");
    mocks.fileToInlineImage.mockResolvedValue({ mimeType: "image/jpeg", base64Data: "abc123" });
    mocks.getWeatherProactiveAlerts.mockResolvedValue([]);
  });

  it("resolves voice readiness and shows the idle prompt when there is no history", async () => {
    const { result } = renderHook(() => useVoiceConversation());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));
    expect(result.current.phase).toBe("idle");
    expect(result.current.answerText).toBe("Ask me anything about your farm.");
    expect(result.current.greetingLine).toBe("Vanakkam, Meena");
  });

  it("speaks a greeting once when there is no prior history", async () => {
    renderHook(() => useVoiceConversation());
    await waitFor(() => expect(mocks.speak).toHaveBeenCalledOnce());
    expect(mocks.speak.mock.calls[0][0]).toContain("Vanakkam, Meena");
  });

  it("does not greet when history already exists", async () => {
    mocks.loadAdvisorMessages.mockResolvedValue([{ role: "farmer", text: "hi", timestamp: TIMESTAMP }]);
    const { result } = renderHook(() => useVoiceConversation());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));
    await waitFor(() => expect(mocks.loadAdvisorMessages).toHaveBeenCalled());
    expect(mocks.speak).not.toHaveBeenCalled();
  });

  it("handleSend dispatches the typed question and speaks the answer", async () => {
    const { result } = renderHook(() => useVoiceConversation());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));

    act(() => result.current.setTypedQuestion("When should I sow groundnut?"));
    act(() => result.current.handleSend());

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(mocks.dispatch).toHaveBeenCalledWith(
      "answer-farm-question",
      expect.objectContaining({ question: "When should I sow groundnut?", farmerName: "Meena" })
    );
    expect(mocks.recordMemory).toHaveBeenCalledWith("farmer", "When should I sow groundnut?");
    expect(mocks.recordMemory).toHaveBeenCalledWith("assistant", "Sow now.");
    expect(mocks.speak).toHaveBeenCalledWith("Sow now.");
    expect(result.current.answerText).toBe("Sow now.");
    expect(result.current.typedQuestion).toBe("");
  });

  it("handleSend does nothing for an empty or whitespace-only question", async () => {
    const { result } = renderHook(() => useVoiceConversation());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));
    act(() => result.current.setTypedQuestion("   "));
    act(() => result.current.handleSend());
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("surfaces a VoiceProxyError's message, sets phase to error, and never speaks a failed answer", async () => {
    mocks.dispatch.mockRejectedValue(new mocks.MockVoiceProxyError(503, "Sarvam is not configured on the server."));
    const { result } = renderHook(() => useVoiceConversation());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));
    await waitFor(() => expect(mocks.speak).toHaveBeenCalledOnce()); // the initial greeting — expected

    act(() => result.current.setTypedQuestion("Any question"));
    act(() => result.current.handleSend());

    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.errorMessage).toBe("Sarvam is not configured on the server.");
    expect(mocks.speak).toHaveBeenCalledOnce(); // still just the greeting — never spoke the failed answer
  });

  it("falls back to a generic message for a non-VoiceProxyError failure", async () => {
    mocks.dispatch.mockRejectedValue(new Error("network exploded"));
    const { result } = renderHook(() => useVoiceConversation());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));

    act(() => result.current.setTypedQuestion("Any question"));
    act(() => result.current.handleSend());

    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.errorMessage).toBe("That did not go through — please try again.");
  });

  it("starts and stops recording via the mic control, transcribing and asking on stop", async () => {
    const { result } = renderHook(() => useVoiceConversation());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));

    act(() => result.current.handleMicClick());
    await waitFor(() => expect(result.current.phase).toBe("recording"));
    expect(mocks.recorderStart).toHaveBeenCalledOnce();

    act(() => result.current.handleMicClick());
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(mocks.recorderStop).toHaveBeenCalledOnce();
    expect(mocks.transcribeAudio).toHaveBeenCalledWith("abc", "audio/wav");
    expect(mocks.dispatch).toHaveBeenCalledWith("answer-farm-question", expect.objectContaining({ question: "When should I sow?" }));
  });

  it("surfaces a clear message when microphone access is denied", async () => {
    mocks.recorderStart.mockRejectedValue(new Error("Permission denied"));
    const { result } = renderHook(() => useVoiceConversation());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));

    act(() => result.current.handleMicClick());
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.errorMessage).toContain("Microphone access was denied");
  });

  it("does not allow starting a new recording while busy", async () => {
    mocks.dispatch.mockImplementation(() => new Promise(() => {})); // never resolves — stays "thinking"
    const { result } = renderHook(() => useVoiceConversation());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));

    act(() => result.current.setTypedQuestion("Any question"));
    act(() => result.current.handleSend());
    await waitFor(() => expect(result.current.busy).toBe(true));

    act(() => result.current.handleMicClick());
    expect(mocks.recorderStart).not.toHaveBeenCalled();
  });

  it("captures a substantial first message as the declared situation and includes it in the same dispatch", async () => {
    const { result } = renderHook(() => useVoiceConversation());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));

    act(() => result.current.setTypedQuestion("I grow groundnut near Coimbatore on two acres"));
    act(() => result.current.handleSend());

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(mocks.dispatch).toHaveBeenCalledWith(
      "answer-farm-question",
      expect.objectContaining({ declaredSituation: "I grow groundnut near Coimbatore on two acres" })
    );
    expect(useFarmStore.getState().declaredSituation).toBe("I grow groundnut near Coimbatore on two acres");
  });

  it("does not capture a short greeting-like first message as the declared situation", async () => {
    const { result } = renderHook(() => useVoiceConversation());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));

    act(() => result.current.setTypedQuestion("hi there"));
    act(() => result.current.handleSend());

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(mocks.dispatch).toHaveBeenCalledWith("answer-farm-question", expect.objectContaining({ declaredSituation: null }));
    expect(useFarmStore.getState().declaredSituation).toBeNull();
  });

  it("never overwrites an already-declared situation with a later message", async () => {
    useFarmStore.setState({ declaredSituation: "Growing tomatoes in Salem" });
    const { result } = renderHook(() => useVoiceConversation());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));

    act(() => result.current.setTypedQuestion("Actually I also grow a completely different long crop now"));
    act(() => result.current.handleSend());

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(useFarmStore.getState().declaredSituation).toBe("Growing tomatoes in Salem");
    expect(mocks.dispatch).toHaveBeenCalledWith(
      "answer-farm-question",
      expect.objectContaining({ declaredSituation: "Growing tomatoes in Salem" })
    );
  });

  it("logs a reactive timeline event for a substantial message", async () => {
    const { result } = renderHook(() => useVoiceConversation());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));

    act(() => result.current.setTypedQuestion("I grow groundnut near Coimbatore on two acres"));
    act(() => result.current.handleSend());

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    const events = useFarmStore.getState().timelineEvents;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ mode: "reactive", kind: "observation", source: "farmer" });
  });

  it("does not log a timeline event for a short greeting-like message", async () => {
    const { result } = renderHook(() => useVoiceConversation());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));

    act(() => result.current.setTypedQuestion("hi there"));
    act(() => result.current.handleSend());

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(useFarmStore.getState().timelineEvents).toHaveLength(0);
  });

  it("passes recent events and upcoming alerts through to the dispatch", async () => {
    useFarmStore.getState().logTimelineEvent({
      mode: "reactive",
      kind: "observation",
      source: "farmer",
      title: "Noticed yellowing leaves",
      detail: "Noticed yellowing leaves on the lower canopy",
    });
    const { result } = renderHook(() => useVoiceConversation());
    await waitFor(() => expect(result.current.voiceReady).toBe(true));

    act(() => result.current.setTypedQuestion("What should I do next?"));
    act(() => result.current.handleSend());

    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(mocks.dispatch).toHaveBeenCalledWith(
      "answer-farm-question",
      expect.objectContaining({ recentEvents: ["Noticed yellowing leaves"], upcomingAlerts: [] })
    );
  });

  describe("uploadLabReport", () => {
    const fakeFile = new File(["fake-bytes"], "report.jpg", { type: "image/jpeg" });

    it("stores a recognised extraction and logs a lab-report timeline event", async () => {
      mocks.dispatch.mockImplementation(async (skillId: string) => {
        if (skillId === "extract-soil-report") {
          return {
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
          };
        }
        return { data: { answer: "Sow now.", topics: ["sowing"] }, source: "local" };
      });

      const { result } = renderHook(() => useVoiceConversation());
      await waitFor(() => expect(result.current.voiceReady).toBe(true));

      await act(async () => {
        await result.current.uploadLabReport(fakeFile);
      });

      expect(result.current.labReportStatus).toBe("success");
      expect(useFarmStore.getState().labReport).toMatchObject({ ph: 6.5, nitrogenKgPerAcre: 80 });
      const events = useFarmStore.getState().timelineEvents;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ kind: "lab-report", source: "agent" });
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

      const { result } = renderHook(() => useVoiceConversation());
      await waitFor(() => expect(result.current.voiceReady).toBe(true));

      await act(async () => {
        await result.current.uploadLabReport(fakeFile);
      });

      expect(result.current.labReportStatus).toBe("error");
      expect(result.current.labReportMessage).toBe("The photo was too blurry to read.");
      expect(useFarmStore.getState().labReport).toBeNull();
      expect(useFarmStore.getState().timelineEvents).toHaveLength(0);
    });

    it("surfaces a generic error when the file itself cannot be read", async () => {
      mocks.fileToInlineImage.mockRejectedValue(new Error("bad file"));
      const { result } = renderHook(() => useVoiceConversation());
      await waitFor(() => expect(result.current.voiceReady).toBe(true));

      await act(async () => {
        await result.current.uploadLabReport(fakeFile);
      });

      expect(result.current.labReportStatus).toBe("error");
      expect(result.current.labReportMessage).toBe("Could not read that file. Please try another photo.");
    });
  });
});
