/**
 * The tool-decision pre-step: the ONE place a caller may ask the model "do you need to look
 * something up before answering?" and get back real, executed tool results — genuine
 * mid-conversation function-calling, not a pre-assembled context string.
 *
 * Deliberately NOT a rewrite of `AiHarness.run()`. This is a small, bounded, fully-skippable
 * pre-step: it runs before a task's normal `getAiHarness().run()` call, and its only job is to
 * produce extra context lines that get folded into that call's existing input. The final
 * answer generation is completely unchanged — same schema validation, cache, retry, one-shot
 * repair, and deterministic fallback as every other task in this app. This is what keeps the
 * "no API key -> full offline fallback" guarantee intact: if any gate below is closed, this
 * step is a no-op and the caller proceeds exactly as it did before tool-calling existed.
 *
 * Bounded by design: at most `maxRounds` (default 2) request/response round trips, so a model
 * that keeps asking for tools can never turn one farmer question into an unbounded loop.
 */
import type { AiFunctionCall, AiToolCallRecord, AiToolDeclaration, AiTransport } from "../contracts/aiTypes";

const DEFAULT_MAX_ROUNDS = 2;
/** Short, bounded budget — this is a lookup step, not the main answer call. */
const DEFAULT_TIMEOUT_MS = 12_000;

/** Executes one tool call and returns its (JSON-serialisable) result. May throw; a throw is treated as a normal, recorded tool failure, never a hard error for the caller. */
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export interface ResolveToolCallsParams {
  /** `null` (or unavailable) short-circuits to a no-op — matches `AiHarness`'s own gate discipline. */
  transport: AiTransport | null;
  /** Only `enabled`/`timeoutMs` are read; the full `HarnessConfig` shape is accepted for convenience. */
  config: { enabled: boolean; timeoutMs?: number };
  /** Defaults to "online" when omitted, mirroring `AiHarness`'s own default. */
  isOnline?: () => boolean;
  /** A short system instruction for the tool-decision round — distinct from the final answer's system prompt. */
  systemContext: string;
  /** The farmer's question (or the running conversation, once a round has already happened). */
  question: string;
  tools: AiToolDeclaration[];
  executeTool: ToolExecutor;
  maxRounds?: number;
}

export interface ResolveToolCallsResult {
  /** Labelled, prompt-ready lines describing what each tool returned — fold these into the caller's normal context assembly. */
  toolContextLines: string[];
  /** One record per tool call actually executed, for `AiCallRecord.toolCalls` / the AI trace panel. */
  toolCallRecords: AiToolCallRecord[];
}

const EMPTY_RESULT: ResolveToolCallsResult = { toolContextLines: [], toolCallRecords: [] };

/** Bounds how much of a tool's JSON result reaches the prompt — a runaway tool output must never blow up the next round's token budget. */
const MAX_TOOL_RESULT_CHARS = 1_200;

function safeStringify(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    if (typeof text !== "string") return "null";
    return text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…` : text;
  } catch {
    return "null";
  }
}

function describeFailure(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return String(err);
  } catch {
    return "tool call failed";
  }
}

async function executeOneCall(
  call: AiFunctionCall,
  executeTool: ToolExecutor,
  now: () => string
): Promise<{ line: string; record: AiToolCallRecord }> {
  try {
    const output = await executeTool(call.name, call.args ?? {});
    return {
      line: `Tool ${call.name}(${safeStringify(call.args)}) returned: ${safeStringify(output)}`,
      record: { name: call.name, input: call.args, output, timestamp: now() },
    };
  } catch (err) {
    const message = describeFailure(err);
    return {
      line: `Tool ${call.name} failed: ${message}`,
      record: { name: call.name, input: call.args, output: { error: message }, timestamp: now() },
    };
  }
}

/**
 * Run the bounded tool-decision loop. Never throws — any failure (transport error, a tool that
 * rejects, a gate closed) degrades to `EMPTY_RESULT` so the caller's normal answer flow is
 * completely unaffected.
 */
export async function resolveToolCalls(params: ResolveToolCallsParams): Promise<ResolveToolCallsResult> {
  const { transport, config, isOnline, systemContext, question, tools, executeTool } = params;
  const maxRounds = Math.max(1, Math.min(4, params.maxRounds ?? DEFAULT_MAX_ROUNDS));

  if (!transport || !config?.enabled) return EMPTY_RESULT;
  if (!Array.isArray(tools) || tools.length === 0) return EMPTY_RESULT;
  if (typeof question !== "string" || question.trim().length === 0) return EMPTY_RESULT;

  try {
    if (!transport.isAvailable()) return EMPTY_RESULT;
    if (typeof isOnline === "function" && isOnline() === false) return EMPTY_RESULT;
  } catch {
    return EMPTY_RESULT;
  }

  const toolContextLines: string[] = [];
  const toolCallRecords: AiToolCallRecord[] = [];
  const now = (): string => new Date().toISOString();
  const timeoutMs = Math.min(config.timeoutMs ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  let conversation = question;

  for (let round = 0; round < maxRounds; round += 1) {
    let result;
    try {
      result = await transport.generate(
        { system: systemContext, user: conversation, tools },
        { timeoutMs }
      );
    } catch {
      // A failed tool-decision round is not a hard error — the caller's main answer call will
      // still run through the normal harness path with whatever context was already gathered.
      break;
    }

    const calls = result.functionCalls;
    if (!calls || calls.length === 0) break;

    const roundLines: string[] = [];
    for (const call of calls) {
      const { line, record } = await executeOneCall(call, executeTool, now);
      roundLines.push(line);
      toolContextLines.push(line);
      toolCallRecords.push(record);
    }

    conversation = `${conversation}\n\n${roundLines.join(
      "\n"
    )}\n\nIf that is enough to answer, respond with no further tool calls. Otherwise call another tool.`;
  }

  return { toolContextLines, toolCallRecords };
}
