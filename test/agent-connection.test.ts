import { stat } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { probeAgent } from "../src/desktop/agent-connection.js";
import { FakeAgents } from "./fakes.js";

it("creates a private database-independent directory, sends no prompts and stops before deletion", async () => {
  const agents = new FakeAgents();
  const start = agents.start.bind(agents);
  agents.start = async (spec, signal) => {
    expect(spec.cwd).toContain("code60-agent-probe-");
    if (process.platform !== "win32") expect((await stat(spec.cwd)).mode & 0o777).toBe(0o700);
    const session = await start(spec, signal);
    const stop = session.stop.bind(session);
    session.stop = async (grace) => {
      expect((await stat(spec.cwd)).isDirectory()).toBe(true);
      await stop(grace);
    };
    return session;
  };
  await probeAgent(agents, { name: "codex", command: ["fake"] }, new AbortController().signal);
  expect(agents.sessions[0]?.prompts).toEqual([]);
  expect(agents.sessions[0]?.stops).toEqual([1000]);
  await expect(stat(agents.specs[0]?.cwd ?? "")).rejects.toThrow();
});
it.each(["auth", "timeout", "cancel"])("cleans up probe directories after %s", async (mode) => {
  const agents = new FakeAgents();
  const abort = new AbortController();
  if (mode === "auth") agents.startError = new Error("ACP authentication required");
  else agents.startGate = new Promise(() => {});
  const pending = probeAgent(
    agents,
    { name: "codex", command: ["fake"] },
    abort.signal,
    mode === "timeout" ? 100 : 15_000,
  );
  const result = expect(pending).rejects.toThrow(
    mode === "auth" ? "authentication" : mode === "timeout" ? "timed out" : "cancelled",
  );
  if (mode === "cancel") {
    await vi.waitFor(() => expect(agents.specs).toHaveLength(1));
    abort.abort();
  }
  await result;
  await expect(stat(agents.specs[0]?.cwd ?? "")).rejects.toThrow();
});
