import type { AutomationDiff, AutomationTranscript } from "../contracts/index.js";
import { AutomationError } from "./errors.js";
import type { ActionRegistry } from "./handlers.js";
import type { Scheduler } from "./scheduler.js";

/** Read evidence without reconciling, recovering, applying, or starting an agent. */
export async function executionEvidence(
  scheduler: Pick<Scheduler, "execution">,
  registry: ActionRegistry,
  executionId: string,
  kind: "transcript" | "diff",
): Promise<AutomationTranscript | AutomationDiff> {
  const execution = scheduler.execution(executionId);
  const handler = registry.get(execution.actionType);
  if (!handler?.readEvidence)
    throw new AutomationError("not_found", "Evidence is unavailable for this job type.");
  return handler.readEvidence(execution, kind);
}
