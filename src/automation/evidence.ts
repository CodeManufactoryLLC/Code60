import { realpath } from "node:fs/promises";
import type { AutomationDiff, AutomationTranscript } from "../contracts/index.js";
import { type CoreDeps, openWorkspace } from "../core/index.js";
import { AutomationError } from "./errors.js";
import { verifyRepository } from "./executor.js";
import type { Scheduler } from "./scheduler.js";

/** Read evidence without reconciling, recovering, applying, or starting an agent. */
export async function executionEvidence(
  scheduler: Pick<Scheduler, "execution">,
  deps: CoreDeps,
  env: Readonly<NodeJS.ProcessEnv>,
  executionId: string,
  kind: "transcript" | "diff",
): Promise<AutomationTranscript | AutomationDiff> {
  const execution = scheduler.execution(executionId);
  if (!execution.runId) throw new AutomationError("not_found", "This occurrence has no agent run.");
  await verifyRepository(execution.repository);
  const workspace = await openWorkspace(deps, execution.repository.path, env);
  const record = await workspace.store.read(execution.runId);
  if (kind === "diff") {
    const pin = execution.evidence;
    if (
      !pin ||
      record.base !== pin.base ||
      record.branch !== pin.branch ||
      (await realpath(record.worktree)) !== pin.worktree.path
    )
      throw new AutomationError("refused", "No pinned isolated changes are available.");
    await verifyRepository(pin.worktree);
    const text = await deps.git.diff(pin.worktree.path, pin.base);
    return {
      executionId,
      runId: record.id,
      text: text.slice(0, 48_000),
      truncated: text.length > 48_000,
    };
  }
  const events = await workspace.store.readEvents(record.id);
  const entries: AutomationTranscript["entries"] = [];
  let size = 0;
  let truncated = false;
  let stream: "message" | "thought" | undefined;
  for (const [index, event] of events.entries()) {
    // Raw protocol records accompany the normalized chunks; never render them twice.
    if (event.type === "acp" || event.type === "sessionState") continue;
    const text =
      "text" in event && typeof event.text === "string"
        ? event.text
        : event.type === "permission"
          ? `${event.kind}: ${event.decision}`
          : event.type === "status"
            ? event.status
            : event.type === "toolCall"
              ? `${event.title}: ${event.status}`
              : "";
    const previous = entries.at(-1);
    const merge = stream === event.type && previous?.type === event.type;
    stream = event.type === "message" || event.type === "thought" ? event.type : undefined;
    if (!text) continue;
    const remaining = 48_000 - size;
    if (remaining <= 0 || (!merge && entries.length >= 500)) {
      truncated = true;
      break;
    }
    if (merge && previous) previous.text += text.slice(0, remaining);
    else
      entries.push({
        key: String(index),
        at: event.at,
        type:
          event.type === "message" ||
          event.type === "thought" ||
          event.type === "prompt" ||
          event.type === "permission" ||
          event.type === "status"
            ? event.type
            : event.type === "toolCall"
              ? "tool"
              : "note",
        text: text.slice(0, remaining),
      });
    size += Math.min(text.length, remaining);
    if (text.length > remaining) truncated = true;
  }
  return {
    executionId,
    runId: record.id,
    status: execution.status,
    reason: execution.reason,
    entries,
    truncated,
  };
}
