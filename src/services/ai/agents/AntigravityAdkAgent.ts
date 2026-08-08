/**
 * Core Antigravity Agent Development Kit (ADK) Base Framework.
 *
 * Provides the foundational agent abstraction for building specialized, tool-augmented,
 * traceable autonomous agricultural agents.
 */

import type { ZodType } from "zod";
import type { InlineImage, PromptPayload } from "../contracts/aiTypes";

/** Represents a callable tool registered on an Antigravity ADK agent. */
export interface AdkAgentTool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  parameters?: ZodType<TInput>;
  execute(input: TInput): Promise<TOutput> | TOutput;
}

/** Configuration metadata for an Antigravity ADK agent. */
export interface AdkAgentConfig {
  name: string;
  role: string;
  instruction: string;
  model?: string;
  tools?: AdkAgentTool[];
  temperature?: number;
}

/** Execution step within an agent's reasoning trajectory. */
export interface AdkAgentStep {
  stepIndex: number;
  thought?: string;
  toolCall?: {
    name: string;
    input: any;
  };
  toolResult?: any;
  observation?: string;
  timestamp: string;
}

/** Full trajectory record from an agent run. */
export interface AdkAgentTrajectory {
  agentName: string;
  role: string;
  taskId: string;
  steps: AdkAgentStep[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

/**
 * Base class for all specialized domain agents built on the Antigravity ADK framework.
 */
export abstract class AntigravityAdkAgent<TInput = any, TOutput = any> {
  public readonly name: string;
  public readonly role: string;
  public readonly instruction: string;
  public readonly model: string;
  protected tools: Map<string, AdkAgentTool> = new Map();

  constructor(config: AdkAgentConfig) {
    this.name = config.name;
    this.role = config.role;
    this.instruction = config.instruction;
    this.model = config.model ?? "gemini-3.6-flash";

    if (config.tools) {
      for (const tool of config.tools) {
        this.registerTool(tool);
      }
    }
  }

  /** Register an executable tool to augment the agent's capabilities. */
  public registerTool(tool: AdkAgentTool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  /** List all tool definitions available to this agent. */
  public getTools(): AdkAgentTool[] {
    return Array.from(this.tools.values());
  }

  /** Compile prompt payload for this agent given an input and context. */
  public abstract buildPrompt(input: TInput): PromptPayload;

  /** Process and validate model/agent output into the target schema. */
  public abstract parseOutput(rawText: string): TOutput;

  /** Run a registered tool safely with error containment. */
  public async executeTool(toolName: string, input: any): Promise<any> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Tool '${toolName}' is not registered on agent '${this.name}'.`);
    }

    if (tool.parameters) {
      const parsed = tool.parameters.safeParse(input);
      if (!parsed.success) {
        throw new Error(`Invalid arguments for tool '${toolName}': ${parsed.error.message}`);
      }
      return await tool.execute(parsed.data);
    }

    return await tool.execute(input);
  }
}
