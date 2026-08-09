/**
 * Zod-validated shape + Firestore collection name for the AI Agent Trace log's backend copy.
 * Mirrors the frontend's `AiCallRecord` (`src/services/ai/contracts/aiTypes.ts`) — kept as a
 * separate copy since server and frontend are distinct TypeScript packages, same reasoning
 * `marketplaceTypes.ts` documents for that boundary.
 *
 * This is a DURABILITY log, not a validation boundary the way `soilReportTypes.ts` is: the
 * nested AI-shaped fields (`response.parsedData`, `toolCalls[].input/output`) vary by task and
 * are left as `z.unknown()` — structural correctness for those already happened on the frontend
 * before the call was ever recorded. A bad/oversized record here fails the outer object's own
 * bounds (see the length caps below) rather than the inner shape, and the route layer just drops
 * a record that doesn't parse rather than 500ing the farmer's actual AI call.
 */

import { z } from "zod";

export const AGENT_TRACES_COLLECTION = "agent_traces";

export const AgentTraceRecordSchema = z.object({
  sessionId: z.string().min(1).max(200),
  taskId: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  source: z.enum(["gemini", "cache", "local", "unavailable"]),
  modelId: z.string().max(200).optional(),
  latencyMs: z.number().finite(),
  degraded: z.boolean(),
  validationRepaired: z.boolean(),
  ok: z.boolean(),
  errorMessage: z.string().max(2000).optional(),
  attempts: z.number().int().finite(),
  /** Assigned client-side by `HarnessTelemetry` — kept as-is (not reassigned server-side) so a farmer's own trace stays in the order they saw it. */
  sequence: z.number().int().finite(),
  notes: z.array(z.string().max(1000)).max(50),
  request: z
    .object({
      system: z.string().max(20000).optional(),
      user: z.string().max(20000).optional(),
      imageCount: z.number().int().finite(),
      imageMimeTypes: z.array(z.string().max(100)),
      useSearchGrounding: z.boolean(),
    })
    .optional(),
  response: z.object({
    rawText: z.string().max(20000).optional(),
    parsedData: z.unknown(),
    groundingUrls: z.array(z.string().max(2000)).optional(),
  }),
  toolCalls: z
    .array(
      z.object({
        name: z.string().max(100),
        input: z.unknown().optional(),
        output: z.unknown().optional(),
        timestamp: z.string().max(100),
      })
    )
    .max(20),
  /** When THIS server persisted it — distinct from the client's own timestamps. */
  loggedAtIso: z.string().min(1),
});

export type AgentTraceRecord = z.infer<typeof AgentTraceRecordSchema>;

// A read-cost cap on the global fetch-then-filter-by-session query (see `agentTraceStore.ts`),
// same trade-off `marketDemand`'s `ORDER_QUERY_LIMIT` already makes rather than requiring a
// Firestore composite index for an equality-filter + orderBy query.
export const TRACE_QUERY_LIMIT = 500;
