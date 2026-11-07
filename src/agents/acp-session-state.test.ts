import {
  type AgentContext,
  agent,
  methods,
  PROTOCOL_VERSION,
  RequestError,
} from "@agentclientprotocol/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openSession, restoreSession } from "./acp-client.js";
import type { AgentUpdate } from "./types.js";

const mode = (value = "ask") => ({
  id: "permissions",
  name: "Permissions",
  category: "mode" as const,
  type: "select" as const,
  currentValue: value,
  options: [
    { value: "ask", name: "Ask" },
    { value: "full", name: "Full Access" },
  ],
});
const model = {
  ...mode(),
  id: "model",
  category: "model" as const,
  currentValue: "m1",
  options: [{ value: "m1", name: "Model One" }],
};
const change = { source: "config" as const, configId: "permissions", value: "full" };
const options = { cwd: "/work", agentName: "test" };
afterEach(() => vi.useRealTimers());

describe("ACP session information transport", () => {
  it("captures setup and early usage, rejects unrelated sessions, and uses returned config after changes", async () => {
    let prompts = 0;
    let requested: unknown;
    const app = agent({ name: "test" })
      .onRequest(methods.agent.initialize, () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, async ({ client }) => {
        await client.notify(methods.client.session.update, {
          sessionId: "wrong",
          update: { sessionUpdate: "usage_update", used: 999, size: 1000 },
        });
        await client.notify(methods.client.session.update, {
          sessionId: "s1",
          update: { sessionUpdate: "usage_update", used: 50, size: 200 },
        });
        return { sessionId: "s1", configOptions: [model, mode()] };
      })
      .onRequest(methods.agent.session.setConfigOption, ({ params }) => {
        requested = params;
        return { configOptions: [model, mode("full")] };
      })
      .onRequest(methods.agent.session.prompt, () => {
        prompts++;
        return { stopReason: "end_turn" };
      });
    const session = await openSession(app, options);
    try {
      expect(session.sessionState.usage?.used).toBe(50);
      expect(session.sessionState.model?.name).toBe("Model One");
      const updates: AgentUpdate[] = [];
      session.onUpdate((update) => updates.push(update));
      await session.setMode(change);
      expect(requested).toEqual({ sessionId: "s1", configId: "permissions", value: "full" });
      expect(session.sessionState.modes?.controls[0]?.currentValue).toBe("full");
      expect(updates.filter((update) => update.type === "sessionState")).toHaveLength(1);
      await expect(session.setMode({ ...change, value: "invented" })).rejects.toThrow(
        /no longer available/,
      );
      expect(prompts).toBe(0);
    } finally {
      session.close();
    }
  });

  it.each(["resume", "load"] as const)(
    "collects restored %s state and suppresses historical transcript",
    async (method) => {
      const app = agent({ name: "test" })
        .onRequest(methods.agent.initialize, () => ({
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities:
            method === "load" ? { loadSession: true } : { sessionCapabilities: { resume: {} } },
        }))
        .onRequest(methods.agent.session[method], async ({ client }: { client: AgentContext }) => {
          await client.notify(methods.client.session.update, {
            sessionId: "saved",
            update: { sessionUpdate: "usage_update", used: 12, size: 100 },
          });
          await client.notify(methods.client.session.update, {
            sessionId: "saved",
            update: { sessionUpdate: "config_option_update", configOptions: [mode("full")] },
          });
          return { configOptions: [model, mode()] };
        });
      const session = await restoreSession(app, { ...options, sessionId: "saved" });
      try {
        expect(session.sessionState.usage?.used).toBe(12);
        expect(session.sessionState.modes?.controls[0]?.currentValue).toBe("ask");
        expect(session.sessionState.model?.name).toBe("Model One");
      } finally {
        session.close();
      }
    },
  );

  it("blocks overlapping prompts, times out without claiming rollback, and recovers on retry", async () => {
    vi.useFakeTimers();
    let hang = true;
    const app = agent({ name: "test" })
      .onRequest(methods.agent.initialize, () => ({ protocolVersion: PROTOCOL_VERSION }))
      .onRequest(methods.agent.session.new, () => ({ sessionId: "s1", configOptions: [mode()] }))
      .onRequest(methods.agent.session.setConfigOption, async ({ signal }) => {
        if (hang)
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
        return { configOptions: [mode("full")] };
      });
    const session = await openSession(app, options);
    try {
      const pending = session.setMode(change);
      const failed = expect(pending).rejects.toThrow(/unconfirmed/);
      await expect(session.prompt("no overlap")).rejects.toThrow(/busy/);
      await expect(session.setMode(change)).rejects.toThrow(/busy/);
      await vi.advanceTimersByTimeAsync(15_000);
      await failed;
      expect(session.sessionState.modes?.confirmed).toBe(false);
      hang = false;
      await session.setMode(change);
      expect(session.sessionState.modes?.confirmed).toBe(true);
      expect(session.sessionState.modes?.controls[0]?.currentValue).toBe("full");
    } finally {
      session.close();
    }
  });

  it("keeps confirmed state on rejection and aborts a pending request on close", async () => {
    let reject = true;
    const app = agent({ name: "test" })
      .onRequest(methods.agent.initialize, () => ({ protocolVersion: PROTOCOL_VERSION }))
      .onRequest(methods.agent.session.new, () => ({ sessionId: "s1", configOptions: [mode()] }))
      .onRequest(methods.agent.session.setConfigOption, async ({ signal }) => {
        if (reject) throw RequestError.invalidParams("Mode refused");
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        return { configOptions: [mode("full")] };
      });
    const session = await openSession(app, options);
    await expect(session.setMode(change)).rejects.toThrow(/Invalid params/);
    expect(session.sessionState.modes?.confirmed).toBe(true);
    expect(session.sessionState.modes?.controls[0]?.currentValue).toBe("ask");
    reject = false;
    const pending = session.setMode(change);
    const failed = expect(pending).rejects.toThrow();
    session.close();
    await failed;
  });

  it("uses legacy set_mode and respects agent-initiated changes", async () => {
    const app = agent({ name: "test" })
      .onRequest(methods.agent.initialize, () => ({ protocolVersion: PROTOCOL_VERSION }))
      .onRequest(methods.agent.session.new, () => ({
        sessionId: "s1",
        modes: {
          currentModeId: "ask",
          availableModes: [
            { id: "ask", name: "Ask" },
            { id: "full", name: "Full" },
          ],
        },
      }))
      .onRequest(methods.agent.session.setMode, async ({ client }) => {
        await client.notify(methods.client.session.update, {
          sessionId: "s1",
          update: { sessionUpdate: "current_mode_update", currentModeId: "ask" },
        });
        return {};
      });
    const session = await openSession(app, options);
    try {
      await session.setMode({ source: "legacy", configId: "mode", value: "full" });
      expect(session.sessionState.modes?.controls[0]?.currentValue).toBe("ask");
    } finally {
      session.close();
    }
  });
});

it("retains notification-only initial configuration and its raw record", async () => {
  const app = agent({ name: "test" })
    .onRequest(methods.agent.initialize, () => ({ protocolVersion: PROTOCOL_VERSION }))
    .onRequest(methods.agent.session.new, async ({ client }) => {
      await client.notify(methods.client.session.update, {
        sessionId: "s1",
        update: {
          sessionUpdate: "config_option_update",
          configOptions: [model, mode()],
        },
      });
      return { sessionId: "s1" };
    });
  const session = await openSession(app, options);
  try {
    expect(session.sessionState.model?.name).toBe("Model One");
    const updates: AgentUpdate[] = [];
    session.onUpdate((update) => updates.push(update));
    expect(updates).toMatchObject([{ type: "acp", update: "config_option_update" }]);
  } finally {
    session.close();
  }
});
