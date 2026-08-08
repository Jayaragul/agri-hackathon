import { describe, it, expect, vi, afterEach } from "vitest";
import { loadHarnessConfig, isAiConfigured } from "../services/ai/runtime/harnessConfig";
import { selectTransport } from "../services/ai/transport/selectTransport";
import { ServerProxyTransport } from "../services/ai/transport/ServerProxyTransport";

describe("harnessConfig — server transport", () => {
  it("is configured and enabled with VITE_AI_TRANSPORT=server and NO client-side API key", () => {
    const config = loadHarnessConfig({ VITE_AI_TRANSPORT: "server" });
    expect(config.apiKey).toBe("");
    expect(config.enabled).toBe(true);
    expect(isAiConfigured(config)).toBe(true);
  });

  it("remains disabled with no key and no server transport", () => {
    const config = loadHarnessConfig({});
    expect(config.enabled).toBe(false);
    expect(isAiConfigured(config)).toBe(false);
  });

  it("respects VITE_AI_ENABLED=false even in server mode", () => {
    const config = loadHarnessConfig({ VITE_AI_TRANSPORT: "server", VITE_AI_ENABLED: "false" });
    expect(config.enabled).toBe(false);
  });

  it("reads VITE_API_BASE_URL and strips a trailing slash", () => {
    const config = loadHarnessConfig({ VITE_AI_TRANSPORT: "server", VITE_API_BASE_URL: "https://api.example.com/" });
    expect(config.apiBase).toBe("https://api.example.com");
  });
});

describe("selectTransport — server preference", () => {
  it("selects ServerProxyTransport with no client key, and only that transport", () => {
    const config = loadHarnessConfig({ VITE_AI_TRANSPORT: "server" });
    const transport = selectTransport(config);
    expect(transport?.id).toBe("server-proxy");
  });
});

describe("ServerProxyTransport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("posts to /api/ai/generate with the resolved model chain and returns the reply", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "Sow now.", modelId: "gemini-3.6-flash" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const config = loadHarnessConfig({ VITE_AI_TRANSPORT: "server" });
    const transport = new ServerProxyTransport(config, "");
    const result = await transport.generate(
      { system: "sys", user: "hello" },
      { timeoutMs: 5000 }
    );

    expect(result.text).toBe("Sow now.");
    expect(result.modelId).toBe("gemini-3.6-flash");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/ai/generate");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.user).toBe("hello");
    expect(body.modelChain).toEqual(config.modelChain);
  });

  it("classifies a 401 from the proxy as an auth error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "bad key" }) })
    );
    const config = loadHarnessConfig({ VITE_AI_TRANSPORT: "server" });
    const transport = new ServerProxyTransport(config, "");

    await expect(transport.generate({ system: "", user: "hi" }, { timeoutMs: 5000 })).rejects.toMatchObject({
      kind: "auth",
    });
  });

  it("is available whenever fetch exists, with no client-side key required", () => {
    const config = loadHarnessConfig({ VITE_AI_TRANSPORT: "server" });
    const transport = new ServerProxyTransport(config, "");
    expect(transport.isAvailable()).toBe(true);
  });
});
