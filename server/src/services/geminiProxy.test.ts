import { describe, expect, it, vi } from "vitest";
import { generateViaGemini, ProxyError } from "./geminiProxy";

describe("generateViaGemini", () => {
  it("refuses to call Gemini without a server-side API key", async () => {
    await expect(generateViaGemini("", { user: "hi", modelChain: ["gemini-3.6-flash"] })).rejects.toMatchObject({
      status: 503,
    });
  });

  it("sends an authenticated request and returns a normalized reply", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "Sow now." }] } }] }),
      text: async () => "",
    })) as unknown as typeof fetch;

    const reply = await generateViaGemini(
      "server-secret",
      { system: "You are a test agent.", user: "What now?", modelChain: ["gemini-3.6-flash"] },
      fetchMock
    );

    expect(reply.text).toBe("Sow now.");
    expect(reply.modelId).toBe("gemini-3.6-flash");
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = vi.mocked(fetchMock).mock.calls[0];
    expect(String(url)).toContain("/models/gemini-3.6-flash:generateContent");
    expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("server-secret");
  });

  it("falls through the model chain on a not-found model and succeeds on the next one", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => "model not found" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
        text: async () => "",
      }) as unknown as typeof fetch;

    const reply = await generateViaGemini(
      "server-secret",
      { user: "hi", modelChain: ["gemini-missing", "gemini-3.6-flash"] },
      fetchMock
    );

    expect(reply.modelId).toBe("gemini-3.6-flash");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops immediately on an auth failure rather than walking the chain", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401, text: async () => "bad key" })) as unknown as typeof fetch;

    await expect(
      generateViaGemini("bad-key", { user: "hi", modelChain: ["gemini-3.6-flash", "gemini-3.5-flash"] }, fetchMock)
    ).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects an empty provider response", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [] }),
      text: async () => "",
    })) as unknown as typeof fetch;

    await expect(generateViaGemini("server-secret", { user: "hi", modelChain: ["gemini-3.6-flash"] }, fetchMock)).rejects.toMatchObject({
      status: 502,
    });
  });

  it("extracts grounding URLs when present", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: { parts: [{ text: "priced at X" }] },
            groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com" } }] },
          },
        ],
      }),
      text: async () => "",
    })) as unknown as typeof fetch;

    const reply = await generateViaGemini("server-secret", { user: "price?", modelChain: ["gemini-3.6-flash"] }, fetchMock);
    expect(reply.groundingUrls).toEqual(["https://example.com"]);
  });

  it("uses a typed ProxyError", () => {
    expect(new ProxyError(400, "bad request")).toMatchObject({ status: 400, message: "bad request" });
  });
});
