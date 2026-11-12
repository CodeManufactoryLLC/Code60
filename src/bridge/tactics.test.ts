import { expect, it } from "vitest";
import { parseOrchestrationChatAction, savedChatSchema, taskContextSchema } from "./index.js";

it("accepts only identity and tactic ID or explicit clear at the selection boundary", () => {
  const action = {
    type: "set-tactic",
    id: "chat-1",
    project: "/project",
    tactic: "independent-review",
  };
  expect(parseOrchestrationChatAction(action)).toEqual(action);
  expect(parseOrchestrationChatAction({ ...action, tactic: null })).toMatchObject({ tactic: null });
  for (const extra of [{ prompt: "injected" }, { version: 99 }, { path: "/tmp" }])
    expect(() => parseOrchestrationChatAction({ ...action, ...extra })).toThrow();
  for (const tactic of [undefined, "", "../prompt", 1])
    expect(() => parseOrchestrationChatAction({ ...action, tactic })).toThrow();
  expect(() =>
    parseOrchestrationChatAction({ type: "continue-task", id: "chat-1", taskId: "../x" }),
  ).toThrow();
});

it("bounds private records and refuses unknown persisted capabilities", () => {
  expect(taskContextSchema.safeParse({ id: "bad", prompt: "arbitrary" }).success).toBe(false);
  expect(savedChatSchema.safeParse({ format: 2 }).success).toBe(false);
});
