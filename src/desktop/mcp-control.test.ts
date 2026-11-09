import { expect, it } from "vitest";
import { workerTranscript } from "./mcp-control.js";

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
