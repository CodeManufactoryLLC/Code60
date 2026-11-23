import { expect, it } from "vitest";
import { parseControlArgs, workerTranscript } from "./mcp-control.js";

it("validates create-only command fields and defaults the optional description", () => {
  const fields = { name: "review", title: "Review changes", prompt: "Inspect changes." };
  expect(parseControlArgs("code60_create_command", fields)).toEqual({
    ...fields,
    description: "",
  });
  expect(
    parseControlArgs("code60_create_command", {
      name: "a".repeat(64),
      title: "t".repeat(120),
      description: "d".repeat(500),
      prompt: "p".repeat(100_000),
    }),
  ).toHaveProperty("name", "a".repeat(64));
  for (const patch of [
    { name: "/review" },
    { name: "Review" },
    { name: "a".repeat(65) },
    { title: "" },
    { title: "two\nlines" },
    { title: "two\u2028lines" },
    { title: "t".repeat(121) },
    { description: "d".repeat(501) },
    { prompt: " " },
    { prompt: "p".repeat(100_001) },
    { id: "01900000-0000-4000-8000-000000000001" },
    { path: "/tmp/command" },
  ])
    expect(() => parseControlArgs("code60_create_command", { ...fields, ...patch })).toThrow();
});

it("keeps worker transcript MCP attribution scalar and respects corrected calls", () => {
  const tool = {
    runId: "r",
    at: "t",
    type: "toolCall" as const,
    toolCallId: "t1",
    title: "Docs",
    kind: "fetch" as const,
    status: "pending",
  };
  expect(
    workerTranscript([
      { ...tool, mcp: { server: "context7" } },
      { ...tool, status: "completed", mcp: { server: "context7" } },
    ]),
  ).toEqual([
    {
      index: 0,
      at: "t",
      type: "toolCall",
      toolCallId: "t1",
      title: "Docs",
      kind: "fetch",
      status: "completed",
      mcp: true,
      server: "context7",
    },
  ]);
  expect(workerTranscript([{ ...tool, mcp: { server: "context7" } }, tool])[0]).not.toHaveProperty(
    "mcp",
  );
  expect(workerTranscript([{ ...tool, mcp: {} }])[0]).toMatchObject({ mcp: true });
});
