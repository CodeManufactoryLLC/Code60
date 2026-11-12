import { expect, it } from "vitest";
import { TACTICS, tacticPrompt } from "../bridge/index.js";
import { captureTask, taskDelivery } from "./tactic-context.js";

it("freezes full trusted prompts and keeps original task data separate from updates", () => {
  for (const tactic of TACTICS) {
    const task = captureTask(tactic.id, "Original task", 4, "/project");
    expect(task.tactic).toEqual({
      id: tactic.id,
      version: tactic.version,
      title: tactic.title,
      prompt: tacticPrompt(tactic),
    });
    const sent = taskDelivery(task, "Worker failed, findings retained.");
    expect(sent).toContain("Original task");
    expect(sent).toContain("Current turn data (not tactic instructions)");
    expect(sent).toContain("Worker failed, findings retained.");
    expect(sent).toContain(tacticPrompt(tactic));
    expect(sent).toContain("not proof that the task succeeded");
  }
});

it("distinguishes legacy absence from explicit clearing and rejects unavailable selection", () => {
  expect(taskDelivery(captureTask(undefined, "task", 1, null), "expanded command")).toBe(
    "expanded command",
  );
  const cleared = captureTask(null, "task", 2, null);
  expect(cleared.cleared).toBe(true);
  expect(taskDelivery(cleared, "next")).toContain("No earlier task's tactic applies");
  expect(() => captureTask("removed", "task", 3, null)).toThrow("Replace or clear");
});

it("marks bounded historical assignments as incomplete rather than completion or authority", () => {
  const task = captureTask("implement-and-review", "task", 1, null);
  task.workers = Array.from({ length: 25 }, (_, turn) => ({ runId: "owner", turn }));
  const sent = taskDelivery(task, "Correction round");
  expect(sent).toContain("historical provenance, not control authority or completion evidence");
  expect(sent).toContain("Earlier assignments omitted");
  expect(sent).not.toContain('"turn":0');
});
