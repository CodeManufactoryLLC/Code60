import { expect, it } from "vitest";
import { parseCustomAgentRequest } from "./custom-agents.js";

it("bounds custom assistant definitions and rejects authority-bearing fields", () => {
  expect(
    parseCustomAgentRequest({ type: "create", name: " A ", instructions: " Keep spaces " }),
  ).toEqual({ type: "create", name: "A", instructions: " Keep spaces " });
  expect(() =>
    parseCustomAgentRequest({
      type: "create",
      name: "N".repeat(120),
      instructions: "x".repeat(32_000),
    }),
  ).not.toThrow();
  for (const value of [
    { type: "create", name: " ", instructions: "x" },
    { type: "create", name: "a\nb", instructions: "x" },
    { type: "create", name: "a", instructions: " " },
    { type: "create", name: "a".repeat(121), instructions: "x" },
    { type: "create", name: "a", instructions: "x".repeat(32_001) },
    { type: "create", name: "a", instructions: "x", cwd: "/tmp" },
    { type: "open", id: "../relay" },
    { type: "archive", id: crypto.randomUUID() },
    { type: "restore", id: crypto.randomUUID(), revision: 0 },
    { type: "list" },
    { type: "read", id: crypto.randomUUID(), command: ["sh"] },
  ])
    expect(() => parseCustomAgentRequest(value)).toThrow();
});
