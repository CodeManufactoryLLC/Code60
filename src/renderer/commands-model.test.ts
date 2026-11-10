import { expect, it } from "vitest";
import type { Command } from "../bridge/index.js";
import { commandProblems, commandRequest, editCommand, emptyCommand } from "./commands-model.js";

it("fills the name from the title only until the name is edited", () => {
  let draft = editCommand(emptyCommand(), "title", "Review code!");
  expect(draft.fields.name).toBe("review-code");
  draft = editCommand(draft, "name", "inspect");
  draft = editCommand(draft, "title", "Another title");
  expect(draft.fields.name).toBe("inspect");
  expect(editCommand(emptyCommand(), "title", "a".repeat(120)).fields.name).toHaveLength(64);
});

it("validates fields and duplicate names without blocking an existing command's own name", () => {
  const fields = { name: "review", title: "Review", prompt: "Inspect.", description: "" };
  const saved: Command = {
    ...fields,
    id: "01900000-0000-4000-8000-000000000001",
    createdAt: "a",
    updatedAt: "b",
  };
  expect(commandProblems(fields, [saved])).toEqual({
    name: "A command with that name already exists",
  });
  expect(commandProblems(fields, [saved], saved.id)).toEqual({});
  expect(commandProblems(emptyCommand().fields, [])).toMatchObject({
    name: expect.any(String),
    title: expect.any(String),
    prompt: expect.any(String),
  });
  expect(commandRequest(fields)).toEqual(fields);
  expect(commandRequest(fields, saved.id)).toEqual({ ...fields, id: saved.id });
});
