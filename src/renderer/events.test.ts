import { describe, expect, it } from "vitest";
import type { RunEvent } from "../core/index.js";
import { eventRows } from "./events.js";

describe("consolidated event rows", () => {
  const runId = "run-123456";
  const at = "2026-01-01T10:00:00.000Z";
  const runs = [{ record: { id: runId, agent: "codex" } }];

  it("distinguishes identified, unknown and ordinary tool servers", () => {
    const tool = {
      runId,
      at,
      type: "toolCall" as const,
      toolCallId: "t",
      title: "MCP playwright",
      kind: "other" as const,
      status: "completed",
    };
    const rows = eventRows(runs, {
      [runId]: [{ ...tool, mcp: { server: "playwright" } }, { ...tool, mcp: {} }, tool],
    });
    expect(rows.map((row) => row.server)).toEqual(["playwright", "Unknown", ""]);
  });

  it("preserves every event, chunk, intermediate tool state, and optional detail", () => {
    const events: RunEvent[] = [
      { runId, at, type: "status", status: "running", reason: "Starting" },
      { runId, at, type: "prompt", turn: 2, text: "Check", origin: "automatic" },
      { runId, at, type: "message", text: "<script>literal</script>" },
      { runId, at, type: "message", text: " second chunk" },
      { runId, at, type: "thought", text: "Thinking" },
      {
        runId,
        at,
        type: "toolCall",
        toolCallId: "t1",
        title: "Read",
        kind: "read",
        status: "pending",
      },
      {
        runId,
        at,
        type: "toolCall",
        toolCallId: "t1",
        title: "Read",
        kind: "read",
        status: "completed",
      },
      {
        runId,
        at,
        type: "permission",
        toolCallId: "t1",
        title: "Read",
        kind: "read",
        decision: "allowed",
        by: "policy",
      },
      { runId, at, type: "note", text: "Handoff", detail: "Full summary\nMore text" },
      { runId, at, type: "stderr", text: "Diagnostic" },
    ];
    const original = structuredClone(events);
    const rows = eventRows(runs, { [runId]: events });
    expect(rows).toHaveLength(events.length);
    expect(new Set(rows.map((row) => row.id)).size).toBe(events.length);
    for (const [index, row] of rows.entries()) {
      expect(row).toMatchObject({ id: `${runId}:${index}`, at, agent: "codex", session: runId });
      expect({ runId, at: row.at, type: row.type, ...JSON.parse(row.details) }).toEqual(
        events[index],
      );
    }
    expect(rows[5]).toMatchObject({ status: "pending", kind: "read", toolCallId: "t1" });
    expect(rows[6]).toMatchObject({ status: "completed" });
    expect(rows[7]).toMatchObject({ status: "allowed" });
    expect(events).toEqual(original);
    expect(
      eventRows(runs, { [runId]: [...events, { runId, at, type: "message", text: "New" }] }).slice(
        0,
        -1,
      ),
    ).toEqual(rows);
  });

  it("includes only the current project's sessions, even with colliding ID suffixes", () => {
    const otherId = "other-123456";
    const events: Record<string, RunEvent[]> = {
      [runId]: [{ runId, at, type: "message", text: "First" }],
      [otherId]: [{ runId: otherId, at, type: "stderr", text: "Second" }],
      elsewhere: [{ runId: "elsewhere", at, type: "message", text: "Not in project" }],
    };
    const rows = eventRows(
      [
        ...runs,
        { record: { id: otherId, agent: "claude" } },
        { record: { id: "empty", agent: "droid" } },
      ],
      events,
    );
    expect(rows.map((row) => [row.session, row.agent])).toEqual([
      [runId, "codex"],
      [otherId, "claude"],
    ]);
    expect(eventRows([], events)).toEqual([]);
    expect(eventRows(runs, {})).toEqual([]);
  });

  it("shows raw ACP payloads, truncation markers, and turn outcomes", () => {
    const payload = '{"sessionUpdate":"plan","entries":[]}';
    const rows = eventRows(runs, {
      [runId]: [
        { runId, at, type: "acp", update: "plan", payload, size: payload.length },
        {
          runId,
          at,
          type: "acp",
          update: "tool_call",
          payload: '{"partial":',
          size: 300000,
          truncated: true,
        },
        { runId, at, type: "turnEnd", turn: 2, stopReason: "max_tokens" },
      ],
    });
    expect(rows[0]).toMatchObject({ type: "acp", update: "plan", details: payload, status: "" });
    expect(rows[1]?.details).toBe('{"partial":… [truncated; 300000 bytes in full]');
    expect(rows[2]).toMatchObject({
      type: "turnEnd",
      status: "max_tokens",
      details: '{"turn":2,"stopReason":"max_tokens"}',
    });
  });
});
