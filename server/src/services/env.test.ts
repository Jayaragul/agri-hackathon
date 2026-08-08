import { describe, expect, it, vi, afterEach } from "vitest";
import { pickApiKey, resolveGeminiApiKey, resolveSarvamApiKey } from "./env";

describe("pickApiKey", () => {
  it("returns an empty string for an unset variable", () => {
    expect(pickApiKey(undefined)).toBe("");
    expect(pickApiKey("")).toBe("");
    expect(pickApiKey("   ")).toBe("");
  });

  it("returns the single key unchanged when only one is given", () => {
    expect(pickApiKey("only-key")).toBe("only-key");
    expect(pickApiKey("  spaced-key  ")).toBe("spaced-key");
  });

  it("picks one of several comma-separated keys, trimmed", () => {
    const raw = "key-a, key-b ,key-c";
    for (let i = 0; i < 20; i++) {
      expect(["key-a", "key-b", "key-c"]).toContain(pickApiKey(raw));
    }
  });

  it("ignores empty entries from stray commas", () => {
    expect(pickApiKey("key-a,,key-b,")).toMatch(/^key-[ab]$/);
  });
});

describe("resolveGeminiApiKey / resolveSarvamApiKey", () => {
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.SARVAM_API_KEY;
    vi.unstubAllEnvs();
  });

  it("falls back to GOOGLE_API_KEY when GEMINI_API_KEY is unset", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "fallback-key");
    expect(resolveGeminiApiKey()).toBe("fallback-key");
  });

  it("rotates across multiple GEMINI_API_KEY values", () => {
    vi.stubEnv("GEMINI_API_KEY", "g1,g2");
    for (let i = 0; i < 20; i++) {
      expect(["g1", "g2"]).toContain(resolveGeminiApiKey());
    }
  });

  it("rotates across multiple SARVAM_API_KEY values", () => {
    vi.stubEnv("SARVAM_API_KEY", "s1,s2,s3");
    for (let i = 0; i < 20; i++) {
      expect(["s1", "s2", "s3"]).toContain(resolveSarvamApiKey());
    }
  });

  it("resolves to empty when nothing is configured", () => {
    expect(resolveSarvamApiKey()).toBe("");
  });
});
