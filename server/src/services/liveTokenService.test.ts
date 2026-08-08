import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createLiveToken, LiveTokenError } from "./liveTokenService";
import { buildCropDoctorSystemInstruction, CROP_DOCTOR_TOOL_NAME } from "./cropDoctorConfig";

describe("buildCropDoctorSystemInstruction", () => {
  it("embeds every candidate pest id, name, and symptom text", () => {
    const instruction = buildCropDoctorSystemInstruction("Tomato", [
      { id: "p001", pestName: "Leaf Miner", symptoms: "Silvery winding tunnels on leaves." },
    ]);
    expect(instruction).toContain("Tomato");
    expect(instruction).toContain("p001");
    expect(instruction).toContain("Leaf Miner");
    expect(instruction).toContain("Silvery winding tunnels on leaves.");
    expect(instruction).toContain(CROP_DOCTOR_TOOL_NAME);
  });

  it("states the list is closed and names none when there are no candidates", () => {
    const instruction = buildCropDoctorSystemInstruction("Sorghum", []);
    expect(instruction).toContain("no verified pest records exist");
  });

  it("forbids inventing a treatment", () => {
    const instruction = buildCropDoctorSystemInstruction("Cotton", []);
    expect(instruction.toLowerCase()).toContain("never add a chemical name");
  });

  it("includes soil numbers, recent events, and upcoming alerts when supplied", () => {
    const instruction = buildCropDoctorSystemInstruction("Tomato", [], {
      farmerName: "Meera",
      situation: "growing tomato in Coimbatore",
      soilSummary: "pH 6.5, N 80, P 40, K 40 kg/acre",
      recentEvents: ["Noticed yellowing leaves on the lower canopy"],
      upcomingAlerts: ["Aphid risk window opening — watch for aphids starting around 2026-07-07."],
    });
    expect(instruction).toContain("WHO YOU ARE TALKING TO");
    expect(instruction).toContain("pH 6.5, N 80, P 40, K 40 kg/acre");
    expect(instruction).toContain("Noticed yellowing leaves on the lower canopy");
    expect(instruction).toContain("Aphid risk window opening");
  });

  it("omits the WHO YOU ARE TALKING TO section entirely when no context is supplied", () => {
    const instruction = buildCropDoctorSystemInstruction("Tomato", []);
    expect(instruction).not.toContain("WHO YOU ARE TALKING TO");
  });

  it("includes the section for soil/events/alerts alone even without a name or situation", () => {
    const instruction = buildCropDoctorSystemInstruction("Tomato", [], {
      upcomingAlerts: ["Harvest window begins in 5 days."],
    });
    expect(instruction).toContain("WHO YOU ARE TALKING TO");
    expect(instruction).toContain("Harvest window begins in 5 days.");
  });
});

describe("createLiveToken", () => {
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });

  afterEach(() => {
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
  });

  it("refuses to mint a token without a server-side API key", async () => {
    await expect(createLiveToken("Tomato", [])).rejects.toMatchObject({ status: 503 });
  });

  it("uses a typed LiveTokenError", () => {
    expect(new LiveTokenError(400, "bad request")).toMatchObject({ status: 400, message: "bad request" });
  });
});
