import { describe, expect, it, vi } from "vitest";
import { speechToText, textToSpeech, SarvamProxyError } from "./sarvamProxy";

const SAMPLE_AUDIO = { mimeType: "audio/wav", base64Data: Buffer.from("fake-audio").toString("base64") };

describe("speechToText", () => {
  it("refuses to call Sarvam without a server-side API key", async () => {
    await expect(speechToText("", SAMPLE_AUDIO, "ta-IN")).rejects.toMatchObject({ status: 503 });
  });

  it("rejects missing audio data", async () => {
    await expect(speechToText("key", { mimeType: "audio/webm", base64Data: "" }, "ta-IN")).rejects.toMatchObject({ status: 400 });
  });

  it("sends an authenticated multipart request and returns the transcript", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ transcript: "vanakkam" }),
      text: async () => "",
    })) as unknown as typeof fetch;

    const transcript = await speechToText("server-secret", SAMPLE_AUDIO, "ta-IN", fetchMock);

    expect(transcript).toBe("vanakkam");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetchMock).mock.calls[0];
    expect(String(url)).toContain("/speech-to-text");
    expect((init?.headers as Record<string, string>)["api-subscription-key"]).toBe("server-secret");
  });

  it("maps an HTTP failure to a SarvamProxyError with the same status", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401, text: async () => "bad key" })) as unknown as typeof fetch;
    await expect(speechToText("bad-key", SAMPLE_AUDIO, "ta-IN", fetchMock)).rejects.toMatchObject({ status: 401 });
  });
});

describe("textToSpeech", () => {
  it("refuses to call Sarvam without a server-side API key", async () => {
    await expect(textToSpeech("", "hello", "ta-IN")).rejects.toMatchObject({ status: 503 });
  });

  it("rejects empty text", async () => {
    await expect(textToSpeech("key", "   ", "ta-IN")).rejects.toMatchObject({ status: 400 });
  });

  it("sends a JSON request and returns the base64 audio", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ audios: ["base64wav"] }),
      text: async () => "",
    })) as unknown as typeof fetch;

    const audio = await textToSpeech("server-secret", "vanakkam", "ta-IN", fetchMock);

    expect(audio).toBe("base64wav");
    const [, init] = vi.mocked(fetchMock).mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.inputs).toEqual(["vanakkam"]);
    expect(body.target_language_code).toBe("ta-IN");
  });

  it("rejects an empty audios array from the provider", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ audios: [] }),
      text: async () => "",
    })) as unknown as typeof fetch;

    await expect(textToSpeech("server-secret", "hello", "ta-IN", fetchMock)).rejects.toMatchObject({ status: 502 });
  });

  it("uses a typed SarvamProxyError", () => {
    expect(new SarvamProxyError(400, "bad request")).toMatchObject({ status: 400, message: "bad request" });
  });
});
