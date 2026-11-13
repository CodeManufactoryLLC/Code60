import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { MemoryGeneration, MemorySource } from "../src/contracts/index.js";
import {
  checkpointText,
  estimateMemoryTokens,
  generateAgentMemory,
  memoryGenerationPrompt,
  validateMemoryGeneration,
} from "../src/core/agent-memory.js";
import { FakeAgents, type TurnScript } from "./fakes.js";

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test fixture value");
  return value;
}

const source: MemorySource = {
  id: randomUUID(),
  conversationId: randomUUID(),
  role: "assistant",
  at: "2026-11-13T12:00:00.000Z",
  text: "Redis tests failed.",
  ordinal: 1,
  start: 0,
};
const value = (): MemoryGeneration => {
  const citations = [
    { sourceId: source.id, start: 0, end: source.text.length, quote: source.text },
  ];
  return {
    goal: "Fix tests",
    constraints: [],
    decisions: [],
    attempts: ["Redis tests failed."],
    questions: [],
    next: "Check Redis",
    citations,
    memories: [
      {
        type: "lesson",
        text: "Check Redis availability.",
        subject: "redis-tests",
        condition: "Before Redis integration tests",
        correction: false,
        citations,
      },
    ],
  };
};
describe("evidence-only memory generation", () => {
  it("estimates tokens conservatively and builds bounded typed evidence prompts", () => {
    expect(estimateMemoryTokens("a😀")).toBe(3);
    expect(estimateMemoryTokens("abcdef文")).toBe(4);
    expect(estimateMemoryTokens("\ud800x")).toBe(3);
    expect(memoryGenerationPrompt([source], "previous")).toContain("untrusted evidence");
    expect(checkpointText(value())).not.toContain('"memories"');
    expect(validateMemoryGeneration(value(), [source])).toEqual(value());
  });
  it("rejects unknown sources, out-of-range or mismatched spans, ungrounded checkpoints and unconditional lessons", () => {
    for (const edit of [
      (v: MemoryGeneration) => {
        must(v.citations[0]).sourceId = randomUUID();
      },
      (v: MemoryGeneration) => {
        must(v.citations[0]).end++;
      },
      (v: MemoryGeneration) => {
        must(v.citations[0]).quote = "passed";
      },
      (v: MemoryGeneration) => {
        v.citations = [];
      },
      (v: MemoryGeneration) => {
        must(v.memories[0]).condition = "";
      },
      (v: MemoryGeneration) => {
        must(v.memories[0]).text = "Always restart Redis.";
      },
      (v: MemoryGeneration) => {
        must(v.memories[0]).correction = true;
      },
    ]) {
      const v = structuredClone(value());
      edit(v);
      expect(() => validateMemoryGeneration(v, [source])).toThrow();
    }
  });
  it("uses an isolated turn with denied permissions and unconditional cleanup", async () => {
    const agents = new FakeAgents((_, session) => {
      session.update({ type: "message", text: JSON.stringify(value()) });
      return "end_turn";
    });
    const result = await generateAgentMemory(
      agents,
      { name: "fixture", command: ["fixture"], cwd: "/private" },
      "evidence",
      new AbortController().signal,
    );
    expect(result).toEqual(value());
    expect(agents.specs[0]).not.toHaveProperty("mcpServers");
    expect(agents.sessions[0]?.stops).toEqual([1000]);
    expect(
      await agents.sessions[0]?.requestPermission({
        toolCallId: "tool",
        title: "Read",
        kind: "read",
        options: [],
      }),
    ).toBe("deny");
  });
  it("rejects malformed output, unfinished turns, excessive output, process exit and cancellation", async () => {
    const scripts: TurnScript[] = [
      (_, s) => {
        s.update({ type: "message", text: "not json" });
        return "end_turn";
      },
      () => "cancelled",
      (_, s) => {
        s.update({ type: "message", text: "x".repeat(64001) });
        return "end_turn";
      },
      (_, s) => {
        s.crash();
        return "hang";
      },
    ];
    for (const script of scripts) {
      const agents = new FakeAgents(script);
      await expect(
        generateAgentMemory(
          agents,
          { name: "fixture", command: ["fixture"], cwd: "/private" },
          "",
          new AbortController().signal,
        ),
      ).rejects.toThrow();
      expect(agents.sessions[0]?.stops).toHaveLength(1);
    }
    const abort = new AbortController();
    const agents = new FakeAgents(() => {
      abort.abort();
      return "hang";
    });
    await expect(
      generateAgentMemory(
        agents,
        { name: "fixture", command: ["fixture"], cwd: "/private" },
        "",
        abort.signal,
      ),
    ).rejects.toThrow();
    expect(agents.sessions[0]?.stops).toHaveLength(1);
  });
});
