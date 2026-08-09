/**
 * The tool catalog for `resolveToolCalls.ts`, scoped to the General Farm Advisor / Audio Mode's
 * `answer-farm-question` flow. Deliberately small and mostly LOCAL: three of the four tools call
 * already-existing, already-tested deterministic functions directly — no extra model hop, no new
 * agent. Only `get_live_market_price` legitimately needs another live call, since it's the one
 * search-grounded lookup in the app.
 *
 * Every parameter schema is built with zod and mirrored to JSON-Schema via the SAME
 * `zodToJsonSchema` the A2A catalog already uses for its `A2AToolCard.parameters` — one schema
 * representation for both the human-readable agent catalog and the model-facing tool contract.
 *
 * Per [[krishi-mitra-ai-boundary]]: every tool here PERCEIVES or looks up already-computed
 * engine data. None may originate a score, ranking, financial figure, or dose — `get_calendar_day`
 * and `get_weather_alerts` return facts an engine already decided; `get_live_market_price` returns
 * advisory display data, never fed to `financialEngine`; `recall_more_memories` returns
 * farmer-reported text, never treated as verified.
 */
import { z } from "zod";
import type { AiToolCallRecord, AiToolDeclaration } from "../contracts/aiTypes";
import type { MarketPrice } from "../contracts/aiSchemas";
import { zodToJsonSchema } from "../a2a/zodToJsonSchema";
import { getA2AOrchestrator } from "../a2a";
import type { Crop, FarmProfile, RecommendationResult } from "../../../domain/models/models";
import { deriveCurrentCropCalendarPlan } from "../../../engine/currentCropCalendar";
import { getWeatherProactiveAlerts } from "../../weather/weatherContext";
import { describeProactiveAlert } from "../../../engine/proactiveEngine";
import { recallMemories } from "../../memory/memoryClient";
import { getMarketDemand, publishListing } from "../../marketplace/marketplaceClient";
import { resolveToolCalls, type ResolveToolCallsResult, type ToolExecutor } from "./resolveToolCalls";
import { getAiHarnessConfig, getAiTransport } from "../index";

const marketPriceParams = z.object({
  region: z
    .string()
    .max(120)
    .optional()
    .describe("Region/market to check, e.g. 'Coimbatore'. Defaults to the farmer's own region when omitted."),
});

const calendarDayParams = z.object({
  dayNumber: z
    .number()
    .describe("Day index into the farmer's cultivation calendar (0 = sowing day, negative = soil-prep days before sowing, positive = days into the growing season)."),
});

const weatherParams = z.object({
  region: z
    .string()
    .max(120)
    .optional()
    .describe("Region to check the forecast for. Defaults to the farmer's own region when omitted."),
});

const recallMoreMemoriesParams = z.object({
  query: z.string().min(1).max(300).describe("A focused search query for something specific the farmer may have said in a past conversation."),
});

const marketDemandParams = z.object({});

const sellCropParams = z.object({
  quantity: z.number().positive().describe("How much the farmer wants to sell, in the unit given below. Must come from what the farmer actually said — never guess a number."),
  unit: z.string().min(1).max(20).describe("Unit for quantity, e.g. 'kg', 'piece', 'bunch'. Must come from what the farmer actually said."),
  price: z.number().positive().describe("Price per unit in rupees the farmer wants to sell at. Must come from what the farmer actually said — never invent or estimate one, even from get_market_demand's suggestedPricePerUnit, unless the farmer explicitly agrees to that figure first."),
});

export const FARM_ADVISOR_TOOL_NAMES = {
  marketPrice: "get_live_market_price",
  calendarDay: "get_calendar_day",
  weatherAlerts: "get_weather_alerts",
  recallMemories: "recall_more_memories",
  marketDemand: "get_market_demand",
  sellCrop: "sell_crop",
} as const;

export function buildFarmAdvisorTools(): AiToolDeclaration[] {
  return [
    {
      name: FARM_ADVISOR_TOOL_NAMES.marketPrice,
      description:
        "Look up today's live wholesale/mandi price for the farmer's selected crop. Use this only when the farmer explicitly asks about a current price — never to answer a general question.",
      parameters: zodToJsonSchema(marketPriceParams),
    },
    {
      name: FARM_ADVISOR_TOOL_NAMES.calendarDay,
      description:
        "Look up the exact phase, tasks, and pest risks for one specific day of the farmer's cultivation calendar. Use this when the farmer asks about a particular day or a number of days from now/sowing.",
      parameters: zodToJsonSchema(calendarDayParams),
    },
    {
      name: FARM_ADVISOR_TOOL_NAMES.weatherAlerts,
      description:
        "Look up current weather-driven field alerts (heavy rain, high wind, heat stress, thunderstorms) for the farmer's region. Use this when the farmer asks about weather, spraying conditions, or whether it's safe to work the field.",
      parameters: zodToJsonSchema(weatherParams),
    },
    {
      name: FARM_ADVISOR_TOOL_NAMES.recallMemories,
      description:
        "Search this farmer's past conversations for something specific not already covered by the context you were given. Use this only when the pre-supplied memories don't cover what you need.",
      parameters: zodToJsonSchema(recallMoreMemoriesParams),
    },
    {
      name: FARM_ADVISOR_TOOL_NAMES.marketDemand,
      description:
        "Look up REAL demand for the farmer's selected crop from the FarmConnect marketplace: how many consumers have recently requested it, how much quantity, and a suggested price based on what buyers actually offered. Use this when the farmer asks about demand, whether it's a good time to sell, or what price to ask.",
      parameters: zodToJsonSchema(marketDemandParams),
    },
    {
      name: FARM_ADVISOR_TOOL_NAMES.sellCrop,
      description:
        "Publish a 'now selling' listing to the FarmConnect marketplace and notify every consumer who has requested this crop. This is a REAL, farmer-visible action with real consequences (buyers get notified) — only call this when the farmer has clearly said they want to sell/list it AND has stated (or just explicitly confirmed) a quantity, unit, and price. If any of those three is missing, ask the farmer for it instead of calling this tool.",
      parameters: zodToJsonSchema(sellCropParams),
    },
  ];
}

export interface FarmAdvisorToolContext {
  crop: Crop | null;
  profile: FarmProfile | null;
  topRecommendation: RecommendationResult | null;
  farmerName?: string | null;
}

function readOptionalString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Binds the fixed tool catalog above to one farmer's current context. Every handler is
 * best-effort: a lookup that can't be satisfied (no crop selected, no calendar yet, day out of
 * range) returns a small `{ error }` object rather than throwing, so the model gets a clear
 * "that's not available" signal it can relay honestly instead of the whole tool round failing.
 */
export function createFarmAdvisorToolExecutor(ctx: FarmAdvisorToolContext): ToolExecutor {
  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    switch (name) {
      case FARM_ADVISOR_TOOL_NAMES.marketPrice: {
        if (!ctx.crop) return { error: "No crop is selected for this farm yet." };
        const region = readOptionalString(args, "region") ?? ctx.profile?.region ?? "Coimbatore";
        const outcome = await getA2AOrchestrator().dispatch<MarketPrice>("market-price", {
          crop: ctx.crop,
          region,
        });
        return outcome.data;
      }

      case FARM_ADVISOR_TOOL_NAMES.calendarDay: {
        if (!ctx.crop || !ctx.profile || !ctx.topRecommendation) {
          return { error: "No cultivation calendar is available yet — the farmer hasn't set up a farm profile." };
        }
        const rawDay = args.dayNumber;
        const dayNumber = typeof rawDay === "number" && Number.isFinite(rawDay) ? Math.round(rawDay) : null;
        if (dayNumber === null) return { error: "dayNumber is required." };
        try {
          const plan = deriveCurrentCropCalendarPlan(ctx.profile, ctx.crop, ctx.topRecommendation);
          const day = plan.days.find((d) => d.dayIndex === dayNumber);
          return day ?? { error: `Day ${dayNumber} is outside this crop's calendar.` };
        } catch {
          return { error: "Could not compute the cultivation calendar." };
        }
      }

      case FARM_ADVISOR_TOOL_NAMES.weatherAlerts: {
        const region = readOptionalString(args, "region") ?? ctx.profile?.region ?? null;
        if (!region) return { error: "No region is known for this farm yet." };
        const alerts = await getWeatherProactiveAlerts(region);
        return { alerts: alerts.map(describeProactiveAlert) };
      }

      case FARM_ADVISOR_TOOL_NAMES.recallMemories: {
        const query = readOptionalString(args, "query");
        if (!query) return { error: "query is required." };
        const memories = await recallMemories(query);
        return { memories };
      }

      case FARM_ADVISOR_TOOL_NAMES.marketDemand: {
        if (!ctx.crop) return { error: "No crop is selected for this farm yet." };
        return getMarketDemand(ctx.crop.name);
      }

      case FARM_ADVISOR_TOOL_NAMES.sellCrop: {
        if (!ctx.crop) return { error: "No crop is selected for this farm yet." };
        const quantity = typeof args.quantity === "number" && Number.isFinite(args.quantity) && args.quantity > 0 ? args.quantity : null;
        const unit = readOptionalString(args, "unit");
        const price = typeof args.price === "number" && Number.isFinite(args.price) && args.price > 0 ? args.price : null;
        if (!quantity || !unit || !price) {
          return { error: "quantity, unit, and price are all required — ask the farmer for whichever is missing rather than guessing." };
        }
        const listing = await publishListing({
          cropName: ctx.crop.name,
          quantity,
          unit,
          price,
          farmerName: ctx.farmerName ?? undefined,
          region: ctx.profile?.region,
        });
        if (!listing) return { error: "Could not publish the listing right now — the marketplace may be unreachable. Tell the farmer to try again shortly." };
        return {
          published: true,
          matchedRequesterCount: listing.matchedRequesterCount,
          cropName: listing.cropName,
          quantity: listing.quantity,
          unit: listing.unit,
          price: listing.price,
        };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  };
}

/** Short, farmer-facing label for a tool call — powers the transcript's "Checked: …" chip. Falls back to the raw name for a tool this function hasn't been taught about, so a future tool never renders blank. */
export function describeFarmAdvisorToolCall(record: AiToolCallRecord): string {
  switch (record.name) {
    case FARM_ADVISOR_TOOL_NAMES.marketPrice:
      return "Checked live market price";
    case FARM_ADVISOR_TOOL_NAMES.calendarDay: {
      const day = (record.input as { dayNumber?: unknown } | undefined)?.dayNumber;
      return typeof day === "number" ? `Checked calendar day ${day}` : "Checked the cultivation calendar";
    }
    case FARM_ADVISOR_TOOL_NAMES.weatherAlerts:
      return "Checked the weather forecast";
    case FARM_ADVISOR_TOOL_NAMES.recallMemories:
      return "Searched past conversations";
    case FARM_ADVISOR_TOOL_NAMES.marketDemand:
      return "Checked marketplace demand";
    case FARM_ADVISOR_TOOL_NAMES.sellCrop: {
      const qty = (record.input as { quantity?: unknown } | undefined)?.quantity;
      const unit = (record.input as { unit?: unknown } | undefined)?.unit;
      return typeof qty === "number" && typeof unit === "string" ? `Published listing: ${qty} ${unit}` : "Published a marketplace listing";
    }
    default:
      return `Checked: ${record.name}`;
  }
}

const TOOL_SYSTEM_CONTEXT =
  "You are the tool-routing step for Thulir's General Farm Advisor. Given a farmer's " +
  "question, decide whether answering it well needs a tool call, or whether you already have " +
  "enough information. Only call a tool when the question specifically needs live/current data " +
  "(today's market price, a specific calendar day, current weather, or a past-conversation " +
  "detail not already supplied) that general agronomy knowledge cannot provide. If no tool is " +
  "needed, reply with a short acknowledgement and make no function call.";

/**
 * The one call site both Audio Mode (`useVoiceConversation.ts`) and the typed Advisor
 * (`FarmAdvisor.tsx`) use — wires the fixed tool catalog + this farmer's context into
 * `resolveToolCalls()` using the app's shared transport/config singletons. Both surfaces get
 * real tool-calling for free since they already share the same `answer-farm-question` skill.
 */
export async function runFarmAdvisorToolLoop(
  question: string,
  ctx: FarmAdvisorToolContext
): Promise<ResolveToolCallsResult> {
  return resolveToolCalls({
    transport: getAiTransport(),
    config: getAiHarnessConfig(),
    systemContext: TOOL_SYSTEM_CONTEXT,
    question,
    tools: buildFarmAdvisorTools(),
    executeTool: createFarmAdvisorToolExecutor(ctx),
  });
}
