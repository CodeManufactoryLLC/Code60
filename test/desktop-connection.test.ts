import { describe, expect, it, vi } from "vitest";
import { testAgentConnection } from "../src/desktop/agent-connection.js";
import { FakeAgents } from "./fakes.js";

const spec = { name: "fake", command: ["fake-acp"] as [string], cwd: "/db/.code60_workspace" };

describe("ACP connection probe", () => {
  it("opens a session, allows once without asking, and stops without sending a prompt", async () => {
    const agents = new FakeAgents();
    const start = agents.start.bind(agents);
    agents.start = async (...args) => {
      const session = await start(...args);
      const stop = session.stop.bind(session);
      session.stop = async (grace) => {
        expect(
          await agents.sessions[0]?.requestPermission({
            toolCallId: "edit",
            title: "Edit",
            kind: "edit",
          }),
        ).toBe("allow");
        await stop(grace);
      };
      return session;
    };
    await testAgentConnection(agents, spec, new AbortController().signal);
    expect(agents.specs).toEqual([spec]);
    expect(agents.sessions[0]?.prompts).toEqual([]);
    expect(agents.sessions[0]?.stops).toEqual([1000]);
  });

  it("propagates ACP and authentication errors", async () => {
    const agents = new FakeAgents();
    agents.startError = new Error("Log in through the agent CLI");
    await expect(testAgentConnection(agents, spec, new AbortController().signal)).rejects.toThrow(
      "Log in",
    );
  });

  it("times out hung starts and supports cancellation", async () => {
    const agents = new FakeAgents();
    agents.startGate = new Promise(() => {});
    const aborted = vi.fn();
    const start = agents.start.bind(agents);
    agents.start = (spec, signal) => {
      signal?.addEventListener("abort", aborted, { once: true });
      return start(spec, signal);
    };
    await expect(
      testAgentConnection(agents, spec, new AbortController().signal, 10),
    ).rejects.toThrow("timed out");
    const controller = new AbortController();
    const test = testAgentConnection(agents, spec, controller.signal);
    controller.abort();
    await expect(test).rejects.toThrow("cancelled");
    expect(aborted).toHaveBeenCalledTimes(2);
  });
});
