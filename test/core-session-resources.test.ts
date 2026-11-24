import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "../src/agents/index.js";
import { sessionResourceAgents } from "../src/core/session-resources.js";
import { FakeAgents } from "./fakes.js";

const spec = { name: "fixture", command: ["fixture"] as const, cwd: "/actual/cwd" };
const controls = { idle: () => true, canRestore: () => true, reconnect: async () => {} };
describe("optional core session resources", () => {
  it("preserves prototype methods and dynamic optional capabilities; closes resources once", async () => {
    const agents = new FakeAgents();
    const close = vi.fn(async () => {});
    const begin = vi.fn();
    const end = vi.fn();
    const wrapped = sessionResourceAgents(
      agents,
      async () => ({ servers: [], beginTurn: begin, endTurn: end, close }),
      "run",
      1000,
      controls,
    );
    const session = await wrapped.start(spec);
    const raw: AgentSession | undefined = agents.sessions[0];
    if (!raw) throw new Error("Missing adapter");
    expect(agents.specs[0]?.mcpServers).toBeUndefined();
    raw.setMode = vi.fn(async () => {});
    await session.setMode?.({ source: "legacy", configId: "mode", value: "ask" });
    expect(raw.setMode).toHaveBeenCalledOnce();
    await session.prompt("hello");
    expect(begin).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    await session.cancel();
    await session.stop(0);
    await session.exited;
    expect(agents.sessions[0]?.cancels).toBe(1);
    expect(close).toHaveBeenCalledOnce();
  });
  it("calls the factory for new and restored physical sessions with fresh descriptors", async () => {
    const agents = new FakeAgents();
    let generation = 0;
    const wrapped = sessionResourceAgents(
      agents,
      async (context) => ({
        servers: [
          {
            name: "fixture",
            command: "/fixed-adapter",
            args: [],
            env: [{ name: "CAPABILITY", value: `${++generation}:${context.cwd}` }],
          },
        ],
        beginTurn() {},
        endTurn() {},
        close: async () => {},
      }),
      "run",
      1000,
      controls,
    );
    const first = await wrapped.start(spec);
    await first.stop(0);
    const second = await wrapped.restore!(spec, first.sessionId);
    expect(agents.specs[0]?.mcpServers).not.toEqual(agents.restores[0]?.spec.mcpServers);
    expect(agents.sessions[1]?.prompts).toEqual([]);
    await second.stop(0);
  });
});
