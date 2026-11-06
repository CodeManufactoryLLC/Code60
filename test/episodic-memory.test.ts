import { describe, expect, it, vi } from "vitest";
import { parseMemoryExtraction, parseMemoryRequestId } from "../src/bridge/index.js";
import { extractEpisodicMemory, parseMemoryStatements } from "../src/core/episodic-memory.js";
import type { RunEvent } from "../src/core/index.js";
import { FakeAgents } from "./fakes.js";

const spec = { name: "fake", command: ["fake"] as [string], cwd: "/temporary-extraction" };
const event = (text: string): RunEvent => ({
  type: "message",
  runId: "run-1",
  at: "2026-11-05T10:00:00Z",
  text,
});
const signal = () => new AbortController().signal;
const answer = (statements: string[]) => JSON.stringify({ statements });

describe("episodic memory extraction", () => {
  it("extracts statements from all chunks in isolated sessions and removes repeated statements", async () => {
    const events = [event("a".repeat(70_000)), event("The project uses npm.")];
    const permissions: Promise<string>[] = [];
    const agents = new FakeAgents((_, session) => {
      permissions.push(
        session.requestPermission({ toolCallId: "edit", title: "Edit", kind: "edit" }),
      );
      session.update({
        type: "message",
        text: answer(["The project uses npm.", "  The user prefers concise responses.  "]),
      });
      return "end_turn";
    });
    const statements = await extractEpisodicMemory(
      agents,
      spec,
      events,
      "Keep project decisions.",
      signal(),
    );
    expect(statements).toEqual(["The project uses npm.", "The user prefers concise responses."]);
    expect(agents.sessions).toHaveLength(3);
    expect(await Promise.all(permissions)).toEqual(["deny", "deny", "deny"]);
    const data = agents.sessions
      .map((session) => {
        expect(session.stops).toEqual([1000]);
        expect(session.prompts[0]).toContain("Keep project decisions.");
        return session.prompts[0]
          ?.split("--- Recorded events ---\n\n")[1]
          ?.split("\n\n--- End recorded events ---")[0];
      })
      .join("");
    expect(data).toBe(events.map((item) => `${JSON.stringify(item)}\n`).join(""));
  });

  it.each(["cancel", "timeout"])(
    "stops a hanging prompt on %s and exposes no partial result",
    async (mode) => {
      const agents = new FakeAgents(() => "hang");
      const abort = new AbortController();
      const pending = extractEpisodicMemory(
        agents,
        spec,
        [event("fact")],
        "Extract",
        abort.signal,
        mode === "timeout" ? 20 : 1000,
      );
      const rejected = expect(pending).rejects.toThrow(
        mode === "cancel" ? "cancelled" : "timed out",
      );
      await vi.waitFor(() => expect(agents.sessions).toHaveLength(1));
      if (mode === "cancel") abort.abort();
      await rejected;
      expect(agents.sessions[0]?.stops).toEqual([1000]);
    },
  );

  it("bounds startup, input size and output size", async () => {
    const agents = new FakeAgents();
    agents.startGate = new Promise(() => {});
    await expect(
      extractEpisodicMemory(agents, spec, [event("fact")], "Extract", signal(), 10),
    ).rejects.toThrow("timed out");
    await expect(extractEpisodicMemory(agents, spec, [], "Extract", signal())).rejects.toThrow(
      "No events",
    );
    await expect(
      extractEpisodicMemory(agents, spec, [event("a".repeat(1_000_000))], "Extract", signal()),
    ).rejects.toThrow("exceeds");
    const noisy = new FakeAgents((_, session) => {
      session.update({ type: "message", text: "x".repeat(64_001) });
      return "hang";
    });
    await expect(
      extractEpisodicMemory(noisy, spec, [event("fact")], "Extract", signal()),
    ).rejects.toThrow("too large");
    expect(noisy.sessions[0]?.stops).toEqual([1000]);
  });

  it("rejects incomplete and malformed results and always stops the agent", async () => {
    for (const reason of ["refusal", "max_tokens", "end_turn"] as const) {
      const agents = new FakeAgents((_, session) => {
        session.update({ type: "message", text: "not JSON" });
        return reason;
      });
      await expect(
        extractEpisodicMemory(agents, spec, [event("fact")], "Extract", signal()),
      ).rejects.toThrow();
      expect(agents.sessions[0]?.stops).toEqual([1000]);
    }
  });

  it("validates structured responses and treats output as text", () => {
    expect(
      parseMemoryStatements('```json\n{"statements":["<script>literal</script>"]}\n```'),
    ).toEqual(["<script>literal</script>"]);
    expect(parseMemoryStatements(answer([]))).toEqual([]);
    for (const value of [
      "null",
      "[]",
      '{"statements":[1]}',
      '{"statements":[""]}',
      '{"statements":[],"extra":true}',
      answer(["a".repeat(2001)]),
    ])
      expect(() => parseMemoryStatements(value)).toThrow();
  });

  it("validates scoped requests, limits, and cancellation IDs", () => {
    const request = {
      requestId: crypto.randomUUID(),
      directory: "/project",
      prompt: "Extract",
      runs: [{ id: "run-1", count: 2 }],
    };
    expect(parseMemoryExtraction(request)).toEqual(request);
    expect(parseMemoryRequestId(request.requestId)).toBe(request.requestId);
    for (const change of [
      { prompt: " " },
      { prompt: "a".repeat(8001) },
      { runs: [] },
      { runs: [request.runs[0], request.runs[0]] },
      { runs: [{ id: "../secret", count: 2 }] },
      {
        runs: [
          { id: "one", count: 10_000 },
          { id: "two", count: 1 },
        ],
      },
      { command: "anything" },
    ])
      expect(() => parseMemoryExtraction({ ...request, ...change })).toThrow();
    expect(() => parseMemoryRequestId("bad")).toThrow();
  });
});
