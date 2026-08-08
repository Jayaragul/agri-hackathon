/**
 * The orchestrator: an in-process agent/skill registry plus a lifecycle-tracked dispatcher.
 *
 * `dispatch()` is the one call site every UI feature should use to reach an agent's skill —
 * never `new SomeAgent()` and never `getAiHarness().run()` directly from a component. That
 * keeps every AI call: (a) discoverable via `listAgentCards()`, (b) uniformly logged to
 * `listTaskLog()` for the trace panel, and (c) swappable — a skill's `run()` is the only thing
 * that has to change if the friend's voice agent, a future planner agent, or a real A2A HTTP
 * transport is added later.
 */

import type { AiOutcome } from "../contracts/aiTypes";
import type { A2AAgentCard, A2AAgentRegistration, A2ASkill } from "./types";

export type A2ATaskState = "submitted" | "working" | "completed" | "failed";

export interface A2ATaskEvent {
  taskId: string;
  agentId: string;
  skillId: string;
  state: A2ATaskState;
  timestamp: number;
  outcomeSource?: string;
  errorMessage?: string;
}

const MAX_TASK_LOG = 200;

export class A2AOrchestrator {
  private readonly registrations = new Map<string, A2AAgentRegistration>();
  private readonly skillIndex = new Map<string, { agentId: string; skill: A2ASkill }>();
  private readonly taskLog: A2ATaskEvent[] = [];
  private sequence = 0;

  register(registration: A2AAgentRegistration): void {
    this.registrations.set(registration.card.id, registration);
    for (const skill of registration.skills) {
      this.skillIndex.set(skill.id, { agentId: registration.card.id, skill });
    }
  }

  listAgentCards(): A2AAgentCard[] {
    return Array.from(this.registrations.values()).map((r) => r.card);
  }

  getAgentCard(agentId: string): A2AAgentCard | null {
    return this.registrations.get(agentId)?.card ?? null;
  }

  findSkill(skillId: string): { agentId: string; skill: A2ASkill } | null {
    return this.skillIndex.get(skillId) ?? null;
  }

  listTaskLog(): A2ATaskEvent[] {
    return this.taskLog.slice();
  }

  /** Route one call through its owning agent's skill, recording the full task lifecycle. */
  async dispatch<TOutput = unknown>(skillId: string, input: unknown): Promise<AiOutcome<TOutput>> {
    const taskId = `a2a-${++this.sequence}`;
    const entry = this.skillIndex.get(skillId);

    if (!entry) {
      const message = `No agent registered for skill "${skillId}".`;
      this.record(taskId, "unknown", skillId, "failed", undefined, message);
      throw new Error(message);
    }

    this.record(taskId, entry.agentId, skillId, "submitted");
    this.record(taskId, entry.agentId, skillId, "working");

    try {
      const outcome = await entry.skill.run(input);
      this.record(taskId, entry.agentId, skillId, "completed", outcome.source);
      return outcome as AiOutcome<TOutput>;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.record(taskId, entry.agentId, skillId, "failed", undefined, message);
      throw err;
    }
  }

  private record(
    taskId: string,
    agentId: string,
    skillId: string,
    state: A2ATaskState,
    outcomeSource?: string,
    errorMessage?: string
  ): void {
    this.taskLog.push({ taskId, agentId, skillId, state, timestamp: Date.now(), outcomeSource, errorMessage });
    if (this.taskLog.length > MAX_TASK_LOG) this.taskLog.shift();
  }
}
