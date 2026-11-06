import { describe, expect, it } from "vitest";
import type { RunEvent } from "../core/index.js";
import { messageRows } from "./messages.js";

describe("message table rows", () => {
  it("keeps sessions separate and ignores events from another project", () => {
    const at = "2026-01-01T10:00:00.000Z";
    const events: Record<string, RunEvent[]> = {
      first: [{ runId: "first", at, type: "message", text: "First reply" }],
      second: [{ runId: "second", at, type: "message", text: "Second reply" }],
      elsewhere: [{ runId: "elsewhere", at, type: "message", text: "Other project" }],
    };
    const runs = [
      { record: { id: "first", agent: "codex" } },
      { record: { id: "second", agent: "claude" } },
      { record: { id: "empty", agent: "droid" } },
    ];
    const rows = messageRows(runs, events);
    expect(rows.map((row) => [row.agent, row.text])).toEqual([
      ["codex", "First reply"],
      ["claude", "Second reply"],
    ]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
    expect(messageRows([], events)).toEqual([]);
    expect(events.first?.[0]).toMatchObject({ text: "First reply" });
  });

  it("includes prompts, messages, and thoughts, grouping streamed text", () => {
    const runId = "run-123456";
    const runs = [{ record: { id: runId, agent: "codex" } }];
    const events: RunEvent[] = [
      { runId, at: "2026-01-01T10:00:00.000Z", type: "prompt", turn: 1, text: "Fix the bug" },
      { runId, at: "2026-01-01T10:00:01.000Z", type: "message", text: "I will " },
      { runId, at: "2026-01-01T10:00:02.000Z", type: "message", text: "investigate." },
      {
        runId,
        at: "2026-01-01T10:00:03.000Z",
        type: "toolCall",
        toolCallId: "tool-1",
        title: "Read file",
        kind: "read",
        status: "completed",
      },
      { runId, at: "2026-01-01T10:00:04.000Z", type: "message", text: "The fix is ready." },
      { runId, at: "2026-01-01T10:00:05.000Z", type: "thought", text: "Check the test." },
      { runId, at: "2026-01-01T10:00:06.000Z", type: "thought", text: " before finishing." },
      { runId, at: "2026-01-01T10:00:07.000Z", type: "status", status: "finished" },
      { runId, at: "2026-01-01T10:00:08.000Z", type: "stderr", text: "diagnostic" },
    ];

    expect(messageRows(runs, { [runId]: events })).toEqual([
      {
        id: `${runId}:0`,
        at: "2026-01-01T10:00:00.000Z",
        agent: "codex",
        session: "123456",
        kind: "Prompt",
        text: "Fix the bug",
      },
      {
        id: `${runId}:1`,
        at: "2026-01-01T10:00:01.000Z",
        agent: "codex",
        session: "123456",
        kind: "Message",
        text: "I will investigate.",
      },
      {
        id: `${runId}:4`,
        at: "2026-01-01T10:00:04.000Z",
        agent: "codex",
        session: "123456",
        kind: "Message",
        text: "The fix is ready.",
      },
      {
        id: `${runId}:5`,
        at: "2026-01-01T10:00:05.000Z",
        agent: "codex",
        session: "123456",
        kind: "Thought",
        text: "Check the test. before finishing.",
      },
    ]);
  });
});
