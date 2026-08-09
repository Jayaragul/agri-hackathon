import { describe, it, expect } from "vitest";
import {
  AgronomistExplainerAgent,
  SoilReportExtractorAgent,
  PestDiagnosticianAgent,
  MarketIntelligenceAgent,
  AntigravityAdkTransport,
  selectTransport,
  loadHarnessConfig,
} from "../services/ai";
import { sampleCrops } from "../data/sample/crops";
import { samplePests } from "../data/sample/pests";
import { demoProfile } from "../data/sample/demoProfile";
import type { RecommendationResult } from "../domain/models/models";

describe("Antigravity ADK (Agent Development Kit) Framework", () => {
  describe("AgronomistExplainerAgent", () => {
    it("compiles structured prompt with decision traces", () => {
      const agent = new AgronomistExplainerAgent();
      const crop = sampleCrops[0];
      const result: RecommendationResult = {
        crop,
        score: 92,
        decisionStatus: "recommended",
        confidence: "high",
        componentScores: {
          season: 15,
          sowingMonth: 15,
          ph: 25,
          nitrogen: 8,
          phosphorus: 8,
          potassium: 8,
          soilType: 12,
          region: 9,
        },
        deficits: {
          nitrogenKgPerAcre: 0,
          phosphorusKgPerAcre: 0,
          potassiumKgPerAcre: 0,
        },
        trace: [
          {
            factor: "ph",
            status: "good",
            pointsAwarded: 25,
            maximumPoints: 25,
            inputValue: 6.8,
            requiredValue: "6.0 - 7.5",
            explanation: "Soil pH is within the ideal range for groundnut.",
          },
        ],
        positiveReasons: ["pH is optimal at 6.8", "Nitrogen level is well matched"],
        riskReasons: [],
        blockingWarnings: [],
      };

      const payload = agent.buildPrompt({
        result,
        profile: demoProfile,
      });

      expect(payload.system).toContain("Thulir");
      expect(payload.user).toContain(crop.name);
      expect(payload.user).toContain("Soil pH: 25.0 of 25");
    });

    it("parses valid JSON response into ExplanationOutput", () => {
      const agent = new AgronomistExplainerAgent();
      const raw = JSON.stringify({
        headline: "Tomato is highly suitable for your farm in Coimbatore.",
        whyThisCrop: ["Ideal soil pH and climate", "High market demand in Coimbatore"],
        risks: ["Requires regular irrigation during dry spells"],
        nextActions: ["Add farmyard manure 2 weeks prior to sowing"],
        plainLanguageSummary: "Tomato matches your soil and climate very well. Add organic compost and maintain drip irrigation.",
      });

      const output = agent.parseOutput(raw);
      expect(output.headline).toContain("Tomato is highly suitable");
      expect(output.whyThisCrop.length).toBe(2);
      expect(output.risks.length).toBe(1);
      expect(output.plainLanguageSummary).toContain("Tomato matches your soil");
    });

    it("handles markdown code fences in output cleanly", () => {
      const agent = new AgronomistExplainerAgent();
      const raw = `\`\`\`json
{
  "headline": "Cotton is well matched for your black soil.",
  "whyThisCrop": ["Soil texture is suitable"],
  "risks": [],
  "nextActions": ["Deep ploughing before onset of monsoon"],
  "plainLanguageSummary": "Cotton is a great choice for your soil conditions."
}
\`\`\``;

      const output = agent.parseOutput(raw);
      expect(output.headline).toBe("Cotton is well matched for your black soil.");
      expect(output.nextActions.length).toBe(1);
    });
  });

  describe("SoilReportExtractorAgent", () => {
    it("creates prompt with inline image payload", () => {
      const agent = new SoilReportExtractorAgent();
      const image = {
        mimeType: "image/jpeg",
        base64Data: "ZmFrZS1pbWFnZS1ieXRlcw==",
      };

      const payload = agent.buildPrompt({ image });
      expect(payload.images).toBeDefined();
      expect(payload.images?.length).toBe(1);
      expect(payload.images?.[0].mimeType).toBe("image/jpeg");
      expect(payload.system).toContain("NEVER GUESS");
    });

    it("parses structured soil extraction output", () => {
      const agent = new SoilReportExtractorAgent();
      const raw = JSON.stringify({
        documentRecognised: true,
        ph: 6.8,
        nitrogenKgPerAcre: 110,
        phosphorusKgPerAcre: 22,
        potassiumKgPerAcre: 140,
        confidence: "high",
        warnings: ["Nitrogen converted from kg/ha to kg/acre"],
      });

      const output = agent.parseOutput(raw);
      expect(output.documentRecognised).toBe(true);
      expect(output.ph).toBe(6.8);
      expect(output.nitrogenKgPerAcre).toBe(110);
      expect(output.confidence).toBe("high");
    });
  });

  describe("PestDiagnosticianAgent", () => {
    it("restricts prompt to closed candidate set", () => {
      const agent = new PestDiagnosticianAgent();
      const crop = sampleCrops[0];
      const candidates = samplePests.filter((p) => p.cropId === crop.id);
      const image = {
        mimeType: "image/png",
        base64Data: "cGVzdC1pbWFnZQ==",
      };

      const payload = agent.buildPrompt({ crop, candidates, image });
      expect(payload.system).toContain("THE LIST IS CLOSED");
      expect(payload.user).toContain(crop.name);
    });
  });

  describe("MarketIntelligenceAgent", () => {
    it("registers search grounding tool and flags search in payload", () => {
      const agent = new MarketIntelligenceAgent();
      const tools = agent.getTools();
      expect(tools.some((t) => t.name === "google_search")).toBe(true);

      const payload = agent.buildPrompt({
        crop: sampleCrops[0],
        region: "Coimbatore",
      });

      expect(payload.useSearchGrounding).toBe(true);
    });
  });

  describe("AntigravityAdkTransport & Transport Selection", () => {
    it("instantiates AntigravityAdkTransport and checks availability", () => {
      const config = loadHarnessConfig({
        VITE_GEMINI_API_KEY: "test-fake-key",
        VITE_AI_TRANSPORT: "adk",
      });

      const transport = new AntigravityAdkTransport(config);
      expect(transport.id).toBe("antigravity-adk");
      expect(transport.isAvailable()).toBe(true);
    });

    it("selectTransport prioritizes AntigravityAdkTransport when transport is 'adk' or 'auto'", () => {
      const configAdk = loadHarnessConfig({
        VITE_GEMINI_API_KEY: "test-fake-key",
        VITE_AI_TRANSPORT: "adk",
      });
      const selectedAdk = selectTransport(configAdk);
      expect(selectedAdk?.id).toBe("antigravity-adk");

      const configAuto = loadHarnessConfig({
        VITE_GEMINI_API_KEY: "test-fake-key",
        VITE_AI_TRANSPORT: "auto",
      });
      const selectedAuto = selectTransport(configAuto);
      expect(selectedAuto?.id).toBe("antigravity-adk");
    });
  });
});
