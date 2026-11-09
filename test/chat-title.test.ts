import { describe, expect, it, vi } from "vitest";
import { parseOrchestrationChatAction } from "../src/bridge/index.js";
import { generateChatTitle } from "../src/core/index.js";
import { FakeAgents } from "./fakes.js";

const spec = { name: "fake", command: ["fake"] as [string], cwd: "/private-title" };
describe("chat titles", () => {
  it("uses a separate bounded turn, denies tools, and stops the agent", async () => {
    let permission: Promise<string> | undefined;
    const agents = new FakeAgents((_, session) => {
      permission = session.requestPermission({ toolCallId: "t", title: "Edit", kind: "edit" });
      session.update({ type: "message", text: "Fix parser validation" });
      return "end_turn";
    });
    expect(
      await generateChatTitle(
        agents,
        spec,
        "x".repeat(20_000),
        "y".repeat(20_000),
        new AbortController().signal,
      ),
    ).toBe("Fix parser validation");
    expect(await permission).toBe("deny");
    expect(agents.sessions[0]?.prompts[0]?.length).toBeLessThan(17_000);
    expect(agents.sessions[0]?.stops).toEqual([1_000]);
    expect(agents.specs[0]?.mcpServers).toBeUndefined();
  });
  it.each(["", "x".repeat(121), "two\nlines"])("rejects an invalid title", async (text) => {
    const agents = new FakeAgents((_, session) => {
      session.update({ type: "message", text });
      return "end_turn";
    });
    await expect(
      generateChatTitle(agents, spec, "task", "reply", new AbortController().signal),
    ).rejects.toThrow();
    expect(agents.sessions[0]?.stops).toEqual([1_000]);
  });
  it("cancels hanging title generation and stops its process", async () => {
    const agents = new FakeAgents(() => "hang");
    const abort = new AbortController();
    const pending = generateChatTitle(agents, spec, "task", "reply", abort.signal);
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(agents.sessions).toHaveLength(1));
    abort.abort();
    await rejected;
    expect(agents.sessions[0]?.stops).toEqual([1_000]);
  });
  it("strictly validates rename and archive actions", () => {
    const id = "20260101-120000-abcdef";
    expect(
      parseOrchestrationChatAction({ type: "rename", id, title: "Parser work" }),
    ).toMatchObject({ title: "Parser work" });
    expect(parseOrchestrationChatAction({ type: "archive", id })).toEqual({ type: "archive", id });
    for (const title of ["", " ", "x".repeat(121), "two\nlines", "\0"])
      expect(() => parseOrchestrationChatAction({ type: "rename", id, title })).toThrow();
    expect(() =>
      parseOrchestrationChatAction({ type: "archive", id, directory: "/tmp" }),
    ).toThrow();
  });
  it("bounds stalled startup to thirty seconds", async () => {
    vi.useFakeTimers();
    try {
      const agents = new FakeAgents();
      agents.startGate = new Promise(() => {});
      const pending = generateChatTitle(
        agents,
        spec,
        "task",
        "reply",
        new AbortController().signal,
      );
      const rejected = expect(pending).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects oversized streamed output and cleans up", async () => {
    const agents = new FakeAgents((_, session) => {
      session.update({ type: "message", text: "x".repeat(2_001) });
      return "hang";
    });
    await expect(
      generateChatTitle(agents, spec, "task", "reply", new AbortController().signal),
    ).rejects.toThrow("too large");
    expect(agents.sessions[0]?.stops).toEqual([1_000]);
  });
});
