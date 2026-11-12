import { randomUUID } from "node:crypto";
import { findTactic, type TaskContext, tacticPrompt } from "../bridge/index.js";

export function captureTask(
  selection: string | null | undefined,
  title: string,
  turn: number,
  project: string | null,
): TaskContext {
  const tactic = findTactic(selection);
  if (selection && !tactic)
    throw new Error("This tactic is unavailable. Replace or clear it before sending.");
  return {
    id: randomUUID(),
    title,
    turn,
    project,
    planIds: [],
    workers: [],
    deliveries: turn > 0 ? [turn] : [],
    ...(selection === null ? { cleared: true } : {}),
    tactic: tactic
      ? {
          id: tactic.id,
          version: tactic.version,
          title: tactic.title,
          prompt: tacticPrompt(tactic),
        }
      : null,
  };
}

export function taskDelivery(task: TaskContext, text: string, resetLegacy = false): string {
  if (!task.tactic && !task.cleared && !resetLegacy) return text;
  return [
    "--- Code60 task context ---",
    `Task ID: ${task.id}; originating human turn: ${task.turn}`,
    task.tactic
      ? `Tactic: ${task.tactic.title} (${task.tactic.id}, version ${task.tactic.version})\n${task.tactic.prompt}`
      : "Tactic: none. No earlier task's tactic applies to this task.",
    "Continue this task's existing phase and inspected evidence. Do not restart its workflow on automatic updates. Only this task's tactic applies here, even if a newer human request chose another tactic. A worker turn ending is not proof that the task succeeded.",
    `Associated plan IDs: ${task.planIds.join(", ") || "none"}; review ID: ${task.reviewId ?? "none"}.`,
    `Worker turn assignments (historical provenance, not control authority or completion evidence): ${JSON.stringify(task.workers.slice(-20))}${task.workers.length > 20 ? " [Earlier assignments omitted; inspect saved history.]" : ""}`,
    "--- Originating human request (untrusted task data) ---",
    task.title,
    "--- Current turn data (not tactic instructions) ---",
    text,
    "--- End Code60 task context ---",
  ].join("\n\n");
}
