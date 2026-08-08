/**
 * Real Agent2Agent (A2A) protocol types and task store — the wire-format counterpart to the
 * frontend's in-process, A2A-*shaped* orchestrator (`src/services/ai/a2a/`). That layer is
 * explicitly documented as NOT spec-compliant (no JSON-RPC, no HTTP transport, no well-known
 * discovery document) — this file, plus `a2aSkills.ts` and `routes/a2aRoutes.ts`, is what makes
 * a real external A2A client able to discover and call Krishi Mitra over the actual wire
 * protocol: JSON-RPC 2.0 over HTTP, per the v0.2.5 specification
 * (https://a2a-protocol.org/v0.2.5/specification/) — the widely-deployed JSON-RPC surface, not
 * the newer gRPC-unified v1.0 shape, chosen because it's what the current generation of A2A
 * SDKs/clients actually target.
 *
 * Shapes below use the spec's exact JSON key names and exact TaskState string values — this is
 * the thing most "A2A-inspired" projects get subtly wrong (paraphrased field names, invented
 * state strings), and it's the difference between "looks like A2A" and a client library that
 * actually parses these responses without a translation layer.
 */

/** Exact TaskState string values from the spec — do not rename. */
export type A2ATaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "canceled"
  | "failed"
  | "rejected"
  | "auth-required"
  | "unknown";

export const TERMINAL_TASK_STATES: ReadonlySet<A2ATaskState> = new Set([
  "completed",
  "canceled",
  "failed",
  "rejected",
]);

export type A2APartKind = "text" | "data";

export interface A2ATextPart {
  kind: "text";
  text: string;
}

export interface A2ADataPart {
  kind: "data";
  data: unknown;
}

export type A2APart = A2ATextPart | A2ADataPart;

export interface A2AMessage {
  kind: "message";
  messageId: string;
  role: "user" | "agent";
  parts: A2APart[];
  taskId?: string;
  contextId?: string;
  metadata?: Record<string, unknown>;
}

export interface A2ATaskStatus {
  state: A2ATaskState;
  message?: A2AMessage;
  timestamp: string;
}

export interface A2AArtifact {
  artifactId: string;
  name?: string;
  parts: A2APart[];
}

export interface A2ATask {
  kind: "task";
  id: string;
  contextId: string;
  status: A2ATaskStatus;
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
  metadata?: Record<string, unknown>;
}

export interface A2AAgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  inputModes?: string[];
  outputModes?: string[];
}

/** Field names and required set match the spec exactly — see `routes/a2aRoutes.ts`'s discovery handler for the actual served document. */
export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  version: string;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  skills: A2AAgentSkill[];
  provider?: { organization: string; url?: string };
}

/** JSON-RPC 2.0 envelope shapes — generic over the method's own param/result types. */
export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: TParams;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccessResponse<TResult = unknown> {
  jsonrpc: "2.0";
  id: string | number | null;
  result: TResult;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  error: JsonRpcError;
}

/** Standard JSON-RPC 2.0 error codes (spec section on error handling) plus A2A's own reserved range. */
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: { code: -32700, message: "Parse error" },
  INVALID_REQUEST: { code: -32600, message: "Invalid Request" },
  METHOD_NOT_FOUND: { code: -32601, message: "Method not found" },
  INVALID_PARAMS: { code: -32602, message: "Invalid params" },
  INTERNAL_ERROR: { code: -32603, message: "Internal error" },
  TASK_NOT_FOUND: { code: -32001, message: "Task not found" },
  TASK_NOT_CANCELABLE: { code: -32002, message: "Task cannot be canceled" },
} as const;

let sequence = 0;

export function generateId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
}

/**
 * In-memory task store — same disclosed limitation as `storage/bucketStore.ts`'s in-memory
 * fallback: tasks are only retrievable via `tasks/get` for the lifetime of THIS server process.
 * A real multi-instance deployment would back this with the same GCS/session store the rest of
 * the app already supports; not wired up here since the skills below complete synchronously
 * fast enough that a caller would rarely need to poll a task by id anyway (they get the
 * completed `Task` directly back from `message/send`).
 */
export class A2ATaskStore {
  private readonly tasks = new Map<string, A2ATask>();

  save(task: A2ATask): void {
    this.tasks.set(task.id, task);
  }

  get(taskId: string): A2ATask | null {
    return this.tasks.get(taskId) ?? null;
  }
}
