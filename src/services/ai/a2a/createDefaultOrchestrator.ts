/**
 * Singleton wiring for the default orchestrator, mirroring the lazy-singleton pattern in
 * `services/ai/index.ts` — importing this module is free, the graph builds on first use, and
 * `resetA2AOrchestrator()` tears it down for tests.
 */

import { getAiHarness } from "../index";
import { A2AOrchestrator } from "./registry";
import { buildAgentRegistrations } from "./agentRegistrations";

let cachedOrchestrator: A2AOrchestrator | null = null;

export function getA2AOrchestrator(): A2AOrchestrator {
  if (cachedOrchestrator === null) {
    cachedOrchestrator = new A2AOrchestrator();
    for (const registration of buildAgentRegistrations(getAiHarness)) {
      cachedOrchestrator.register(registration);
    }
  }
  return cachedOrchestrator;
}

export function resetA2AOrchestrator(): void {
  cachedOrchestrator = null;
}
