/**
 * Binds the four existing Antigravity ADK agents to the harness tasks that already implement
 * them, producing A2A-style `AgentCard`s + callable `Skill`s.
 *
 * This file does not add any new AI behaviour. `AgronomistExplainerAgent`,
 * `SoilReportExtractorAgent`, `PestDiagnosticianAgent` and `MarketIntelligenceAgent` already
 * carry the name/role/model/tool metadata; `createExplainRecommendationTask()` etc. already
 * implement the schema-validated, harness-run, fallback-guaranteed call. This layer only
 * introduces discoverability (the card) and a uniform dispatch surface (the skill's `run`),
 * per [[krishi-mitra-ai-boundary]] — every skill here is "explains" or "perceives", never
 * "decides".
 */

import type { AiHarness } from "../runtime/AiHarness";
import {
  AgronomistExplainerAgent,
  CalendarQueryAgent,
  GeneralFarmAdvisorAgent,
  MarketIntelligenceAgent,
  PestDiagnosticianAgent,
  SoilReportExtractorAgent,
} from "../agents";
import {
  CalendarAnswerSchema,
  ExplanationOutputSchema,
  FarmAdvisorAnswerSchema,
  MarketPriceSchema,
  PestIdentificationSchema,
  SoilReportExtractionSchema,
} from "../contracts/aiSchemas";
import { createExplainRecommendationTask } from "../tasks/explainRecommendationTask";
import { createExtractSoilReportTask } from "../tasks/extractSoilReportTask";
import { createIdentifyPestTask } from "../tasks/identifyPestTask";
import { createMarketPriceTask } from "../tasks/marketPriceTask";
import { createAnswerCalendarQuestionTask } from "../tasks/answerCalendarQuestionTask";
import { createAnswerFarmQuestionTask } from "../tasks/answerFarmQuestionTask";
import { LocalTemplateExplanationProvider } from "../../explanation/LocalTemplateExplanationProvider";
import { zodToJsonSchema } from "./zodToJsonSchema";
import type { A2AAgentRegistration, A2AToolCard } from "./types";

/** Every skill here calls the SAME `AiHarness.run()` path the UI already uses — no shortcuts. */
export function buildAgentRegistrations(getHarness: () => AiHarness): A2AAgentRegistration[] {
  const agronomist = new AgronomistExplainerAgent();
  const soilExtractor = new SoilReportExtractorAgent();
  const pestDiagnostician = new PestDiagnosticianAgent();
  const marketIntelligence = new MarketIntelligenceAgent();
  const calendarQuery = new CalendarQueryAgent();
  const generalFarmAdvisor = new GeneralFarmAdvisorAgent();

  const toolCards = (tools: ReturnType<typeof marketIntelligence.getTools>): A2AToolCard[] =>
    tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ? zodToJsonSchema(tool.parameters) : undefined,
    }));

  return [
    {
      card: {
        id: "agronomist-explainer",
        name: agronomist.name,
        role: agronomist.role,
        description:
          "Turns the deterministic recommendation engine's decision trace into plain-language explanation for the farmer. Never re-scores or re-ranks a crop.",
        model: agronomist.model,
        boundary: "explains",
        capabilities: { streaming: false, pushNotifications: false, toolCalling: false },
        tools: toolCards(agronomist.getTools()),
        skills: [
          {
            id: "explain-recommendation",
            name: "Explain a crop recommendation",
            description:
              "Given the engine's decision trace for one crop, produce a headline, reasons, risks and next actions in plain language.",
            tags: ["explanation", "decision-trace", "farmer-facing"],
            inputSchema: {
              type: "object",
              properties: {
                result: { type: "object", description: "RecommendationResult already computed by the engine." },
                profile: { type: "object", description: "The farmer's FarmProfile." },
              },
              required: ["result", "profile"],
            },
            outputSchema: zodToJsonSchema(ExplanationOutputSchema),
          },
        ],
      },
      skills: [
        {
          id: "explain-recommendation",
          name: "Explain a crop recommendation",
          description: "See agent card.",
          tags: ["explanation", "decision-trace", "farmer-facing"],
          inputSchema: {},
          outputSchema: zodToJsonSchema(ExplanationOutputSchema),
          run: (input) =>
            getHarness().run(
              createExplainRecommendationTask({ localProvider: new LocalTemplateExplanationProvider() }),
              input as never
            ),
        },
      ],
    },
    {
      card: {
        id: "soil-report-extractor",
        name: soilExtractor.name,
        role: soilExtractor.role,
        description:
          "Reads pH and available N/P/K off a photographed Soil Health Card or lab report. Returns null rather than guessing; never writes to the farm profile directly.",
        model: soilExtractor.model,
        boundary: "perceives",
        capabilities: { streaming: false, pushNotifications: false, toolCalling: false },
        tools: toolCards(soilExtractor.getTools()),
        skills: [
          {
            id: "extract-soil-report",
            name: "Extract a soil health card",
            description: "OCR + interpretation of a soil test photo into four editable numbers.",
            tags: ["perception", "ocr", "soil"],
            inputSchema: {
              type: "object",
              properties: {
                image: {
                  type: "object",
                  properties: { mimeType: { type: "string" }, base64Data: { type: "string" } },
                  required: ["mimeType", "base64Data"],
                },
              },
              required: ["image"],
            },
            outputSchema: zodToJsonSchema(SoilReportExtractionSchema),
          },
        ],
      },
      skills: [
        {
          id: "extract-soil-report",
          name: "Extract a soil health card",
          description: "See agent card.",
          tags: ["perception", "ocr", "soil"],
          inputSchema: {},
          outputSchema: zodToJsonSchema(SoilReportExtractionSchema),
          run: (input) => getHarness().run(createExtractSoilReportTask(), input as never),
        },
      ],
    },
    {
      card: {
        id: "pest-diagnostician",
        name: pestDiagnostician.name,
        role: pestDiagnostician.role,
        description:
          "Matches a crop photo against the crop's closed, verified pest list. Never produces open-ended diagnosis or treatment text.",
        model: pestDiagnostician.model,
        boundary: "perceives",
        capabilities: { streaming: false, pushNotifications: false, toolCalling: false },
        tools: toolCards(pestDiagnostician.getTools()),
        skills: [
          {
            id: "identify-pest",
            name: "Match a pest photo",
            description: "Constrained classification against the crop's known pest list.",
            tags: ["perception", "vision", "pest"],
            inputSchema: {
              type: "object",
              properties: {
                image: { type: "object" },
                crop: { type: "object" },
                candidates: { type: "array", items: { type: "object" } },
              },
              required: ["image", "crop", "candidates"],
            },
            outputSchema: zodToJsonSchema(PestIdentificationSchema),
          },
        ],
      },
      skills: [
        {
          id: "identify-pest",
          name: "Match a pest photo",
          description: "See agent card.",
          tags: ["perception", "vision", "pest"],
          inputSchema: {},
          outputSchema: zodToJsonSchema(PestIdentificationSchema),
          run: (input) => getHarness().run(createIdentifyPestTask(), input as never),
        },
      ],
    },
    {
      card: {
        id: "market-intelligence",
        name: marketIntelligence.name,
        role: marketIntelligence.role,
        description:
          "Search-grounded mandi/APMC price lookup, shown beside the engine's dataset price as context only. Never feeds the financial engine.",
        model: marketIntelligence.model,
        boundary: "perceives",
        capabilities: { streaming: false, pushNotifications: false, toolCalling: true },
        tools: toolCards(marketIntelligence.getTools()),
        skills: [
          {
            id: "market-price",
            name: "Look up a live market price",
            description: "Grounded web search for a crop's current wholesale/mandi price near a region.",
            tags: ["perception", "search-grounded", "market"],
            inputSchema: {
              type: "object",
              properties: { crop: { type: "object" }, region: { type: "string" } },
              required: ["crop", "region"],
            },
            outputSchema: zodToJsonSchema(MarketPriceSchema),
          },
        ],
      },
      skills: [
        {
          id: "market-price",
          name: "Look up a live market price",
          description: "See agent card.",
          tags: ["perception", "search-grounded", "market"],
          inputSchema: {},
          outputSchema: zodToJsonSchema(MarketPriceSchema),
          run: (input) => getHarness().run(createMarketPriceTask(), input as never),
        },
      ],
    },
    {
      card: {
        id: "calendar-query",
        name: calendarQuery.name,
        role: calendarQuery.role,
        description:
          "Answers a farmer's free-text question about one day of the deterministic cultivation calendar, grounded strictly in that day's already-computed phase/tasks/risks.",
        model: calendarQuery.model,
        boundary: "explains",
        capabilities: { streaming: false, pushNotifications: false, toolCalling: false },
        tools: toolCards(calendarQuery.getTools()),
        skills: [
          {
            id: "answer-calendar-question",
            name: "Answer a calendar day question",
            description: "Free-text Q&A about one cultivation-calendar day, closed to that day's own facts.",
            tags: ["explanation", "calendar", "farmer-facing"],
            inputSchema: {
              type: "object",
              properties: {
                crop: { type: "object" },
                day: { type: "object", description: "CalendarDay from cropCalendarEngine." },
                question: { type: "string" },
              },
              required: ["crop", "day", "question"],
            },
            outputSchema: zodToJsonSchema(CalendarAnswerSchema),
          },
        ],
      },
      skills: [
        {
          id: "answer-calendar-question",
          name: "Answer a calendar day question",
          description: "See agent card.",
          tags: ["explanation", "calendar", "farmer-facing"],
          inputSchema: {},
          outputSchema: zodToJsonSchema(CalendarAnswerSchema),
          run: (input) => getHarness().run(createAnswerCalendarQuestionTask(), input as never),
        },
      ],
    },
    {
      card: {
        id: "general-farm-advisor",
        name: generalFarmAdvisor.name,
        role: generalFarmAdvisor.role,
        description:
          "Open-ended farming Q&A (soil, crops, pests, irrigation, general practice), grounded in the verified local knowledge base and personalised with the farmer's profile when available. Never overrides an engine score or invents a farm-specific fact.",
        model: generalFarmAdvisor.model,
        boundary: "explains",
        capabilities: { streaming: false, pushNotifications: false, toolCalling: false },
        tools: toolCards(generalFarmAdvisor.getTools()),
        skills: [
          {
            id: "answer-farm-question",
            name: "Ask the farm advisor",
            description: "General farming Q&A grounded in the local knowledge base and (optionally) the farmer's own profile.",
            tags: ["explanation", "knowledge-base", "farmer-facing", "general-qa"],
            inputSchema: {
              type: "object",
              properties: {
                question: { type: "string" },
                profile: { type: "object", nullable: true },
                crop: { type: "object", nullable: true },
                topRecommendation: { type: "object", nullable: true },
                memories: { type: "array", items: { type: "string" } },
                farmerName: { type: "string", nullable: true },
                declaredSituation: { type: "string", nullable: true },
                recentEvents: { type: "array", items: { type: "string" } },
                upcomingAlerts: { type: "array", items: { type: "string" } },
                liveToolResults: { type: "array", items: { type: "string" } },
                spokenStyle: { type: "boolean" },
              },
              required: ["question", "profile", "crop", "topRecommendation"],
            },
            outputSchema: zodToJsonSchema(FarmAdvisorAnswerSchema),
          },
        ],
      },
      skills: [
        {
          id: "answer-farm-question",
          name: "Ask the farm advisor",
          description: "See agent card.",
          tags: ["explanation", "knowledge-base", "farmer-facing", "general-qa"],
          inputSchema: {},
          outputSchema: zodToJsonSchema(FarmAdvisorAnswerSchema),
          run: (input) => getHarness().run(createAnswerFarmQuestionTask(), input as never),
        },
      ],
    },
  ];
}
