/**
 * Types for Krishi Mitra's A2A (Agent2Agent)-style orchestration layer.
 *
 * This is deliberately NOT a spec-compliant A2A server (no JSON-RPC endpoint, no HTTP
 * transport) — it borrows the protocol's core shape (an AgentCard advertising discoverable
 * Skills, dispatched as lifecycle-tracked Tasks) so the app's existing agents are
 * discoverable and callable through one uniform surface, in-process. See `catalog.md` at the
 * repo root for the human-readable rendering of every card produced here.
 *
 * ARCHITECTURE RULE (unchanged by this layer): a skill's `run()` must resolve to an
 * `AiOutcome` produced by `AiHarness.run()` against an existing task — this layer only
 * discovers and routes, it never computes a score, ranking, financial figure or dose itself.
 */

import type { AiOutcome } from "../contracts/aiTypes";

/** Where a skill sits relative to the engine-decides / AI-explains boundary. See CLAUDE memory `krishi-mitra-ai-boundary`. */
export type AiBoundaryRole = "perceives" | "explains" | "perceives-and-explains";

/** Minimal JSON-Schema-shaped object — enough to describe I/O in the catalog and to a model's tool-calling API. */
export interface A2AJsonSchema {
  type?: string;
  properties?: Record<string, A2AJsonSchema>;
  items?: A2AJsonSchema;
  required?: string[];
  enum?: readonly string[];
  nullable?: boolean;
  description?: string;
  [key: string]: unknown;
}

/** One callable capability of an agent. `run` is bound to a concrete task + the shared harness. */
export interface A2ASkill<TInput = any, TOutput = any> {
  id: string;
  name: string;
  description: string;
  tags: string[];
  inputSchema: A2AJsonSchema;
  outputSchema: A2AJsonSchema;
  run(input: TInput): Promise<AiOutcome<TOutput>>;
}

/** The discoverable, serialisable half of a skill — what a card lists, without the closure. */
export type A2ASkillCard = Omit<A2ASkill, "run">;

/** A tool the agent may invoke while producing a skill's output (e.g. Google Search grounding). */
export interface A2AToolCard {
  name: string;
  description: string;
  parameters?: A2AJsonSchema;
}

/** Agent-level discovery document, analogous to an A2A `AgentCard`. */
export interface A2AAgentCard {
  id: string;
  name: string;
  role: string;
  description: string;
  model: string;
  boundary: AiBoundaryRole;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    toolCalling: boolean;
  };
  skills: A2ASkillCard[];
  tools: A2AToolCard[];
}

/** What gets registered with the orchestrator: a card plus the live, callable skills behind it. */
export interface A2AAgentRegistration {
  card: A2AAgentCard;
  skills: A2ASkill[];
}
