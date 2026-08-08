import { describe, it, expect, vi } from "vitest";
import { resolveToolCalls } from "../services/ai/runtime/resolveToolCalls";
import { MockTransport } from "../services/ai/transport/MockTransport";
import type { AiToolDeclaration } from "../services/ai/contracts/aiTypes";

const TOOLS: AiToolDeclaration[] = [
  { name: "get_weather_alerts", description: "test tool", parameters: { type: "object" } },
];

const BASE_PARAMS = {
  config: { enabled: true, timeoutMs: 5000 },
  systemContext: "system",
  question: "Is it going to rain?",
  tools: TOOLS,
};

describe("resolveToolCalls", () => {
  it("returns empty result and makes no calls when the model responds with no function calls", async () => {
    const transport = new MockTransport([{ text: "No tool needed." }]);
    const executeTool = vi.fn();

    const result = await resolveToolCalls({ ...BASE_PARAMS, transport, executeTool });

    expect(result.toolContextLines).toEqual([]);
    expect(result.toolCallRecords).toEqual([]);
    expect(executeTool).not.toHaveBeenCalled();
    expect(transport.callCount).toBe(1);
  });

  it("executes a single tool call and folds the result into toolContextLines/toolCallRecords", async () => {
    const transport = new MockTransport([
      { text: "", functionCalls: [{ name: "get_weather_alerts", args: { region: "Coimbatore" } }] },
      { text: "done" },
    ]);
    const executeTool = vi.fn().mockResolvedValue({ alerts: ["Heavy rain expected"] });

    const result = await resolveToolCalls({ ...BASE_PARAMS, transport, executeTool });

    expect(executeTool).toHaveBeenCalledWith("get_weather_alerts", { region: "Coimbatore" });
    expect(result.toolCallRecords).toHaveLength(1);
    expect(result.toolCallRecords[0].name).toBe("get_weather_alerts");
    expect(result.toolContextLines[0]).toContain("get_weather_alerts");
    expect(result.toolContextLines[0]).toContain("Heavy rain expected");
    expect(transport.callCount).toBe(2);
  });

  it("records a failed tool call instead of throwing", async () => {
    const transport = new MockTransport([
      { text: "", functionCalls: [{ name: "get_weather_alerts", args: {} }] },
      { text: "done" },
    ]);
    const executeTool = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await resolveToolCalls({ ...BASE_PARAMS, transport, executeTool });

    expect(result.toolCallRecords).toHaveLength(1);
    expect(result.toolCallRecords[0].output).toMatchObject({ error: "network down" });
    expect(result.toolContextLines[0]).toContain("failed");
  });

  it("stops after maxRounds even if the model keeps requesting tool calls", async () => {
    const transport = new MockTransport(() => ({
      text: "",
      modelId: "mock-model",
      functionCalls: [{ name: "get_weather_alerts", args: {} }],
    }));
    const executeTool = vi.fn().mockResolvedValue({ alerts: [] });

    const result = await resolveToolCalls({ ...BASE_PARAMS, transport, executeTool, maxRounds: 2 });

    expect(transport.callCount).toBe(2);
    expect(result.toolCallRecords).toHaveLength(2);
  });

  it("is a no-op when the transport is null (offline / not configured)", async () => {
    const executeTool = vi.fn();
    const result = await resolveToolCalls({ ...BASE_PARAMS, transport: null, executeTool });
    expect(result).toEqual({ toolContextLines: [], toolCallRecords: [] });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("is a no-op when config.enabled is false", async () => {
    const transport = new MockTransport([{ text: "ignored" }]);
    const executeTool = vi.fn();
    const result = await resolveToolCalls({
      ...BASE_PARAMS,
      config: { enabled: false },
      transport,
      executeTool,
    });
    expect(result.toolCallRecords).toEqual([]);
    expect(transport.callCount).toBe(0);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("is a no-op when isOnline() reports false", async () => {
    const transport = new MockTransport([{ text: "ignored" }]);
    const executeTool = vi.fn();
    const result = await resolveToolCalls({
      ...BASE_PARAMS,
      transport,
      executeTool,
      isOnline: () => false,
    });
    expect(result.toolCallRecords).toEqual([]);
    expect(transport.callCount).toBe(0);
  });

  it("is a no-op when the transport reports itself unavailable", async () => {
    const transport = new MockTransport([{ text: "ignored" }]);
    transport.available = false;
    const executeTool = vi.fn();
    const result = await resolveToolCalls({ ...BASE_PARAMS, transport, executeTool });
    expect(result.toolCallRecords).toEqual([]);
    expect(transport.callCount).toBe(0);
  });

  it("degrades to empty result (never throws) when the transport call itself fails", async () => {
    const transport = new MockTransport([{ error: new Error("boom") }]);
    const executeTool = vi.fn();
    const result = await resolveToolCalls({ ...BASE_PARAMS, transport, executeTool });
    expect(result).toEqual({ toolContextLines: [], toolCallRecords: [] });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("is a no-op when no tools are supplied", async () => {
    const transport = new MockTransport([{ text: "ignored" }]);
    const executeTool = vi.fn();
    const result = await resolveToolCalls({ ...BASE_PARAMS, tools: [], transport, executeTool });
    expect(result.toolCallRecords).toEqual([]);
    expect(transport.callCount).toBe(0);
  });
});
