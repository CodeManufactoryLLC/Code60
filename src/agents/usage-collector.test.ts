import { agent, methods, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import type { UsageTurnObservation } from "../contracts/index.js";
import { openSession } from "./acp-client.js";
import { SessionUsageCollector } from "./usage-collector.js";

describe("SessionUsageCollector & ACP turn usage capture", () => {
  it("groups parallel tool calls into a single wave and tracks compaction and cost deltas", () => {
    let now = 1_700_000_000_000;
    const collector = new SessionUsageCollector(
      "claude",
      { surface: "project-chat", runId: "r-1" },
      () => now,
    );

    // Pre-turn baseline
    collector.observeUpdate(
      {
        sessionUpdate: "usage_update",
        used: 10_000,
        size: 200_000,
        cost: { amount: 0.12, currency: "USD" },
      },
      64,
    );

    collector.startTurn("Fix the failing test in auth.test.ts");
    now += 1_500;

    // Wave 1: two parallel tool calls
    collector.observeUpdate(
      {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "Read auth.test.ts",
        kind: "read",
        status: "pending",
      },
      80,
    );
    collector.observeUpdate(
      {
        sessionUpdate: "tool_call",
        toolCallId: "t2",
        title: "Read auth.ts",
        kind: "read",
        status: "pending",
      },
      80,
    );
    collector.observeUpdate(
      { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Checking clock." } },
      50,
    );

    // Wave 2: edit after thought boundary
    collector.observeUpdate(
      {
        sessionUpdate: "tool_call",
        toolCallId: "t3",
        title: "Edit auth.test.ts",
        kind: "edit",
        status: "pending",
      },
      80,
    );
    collector.observeUpdate(
      {
        sessionUpdate: "usage_update",
        used: 14_500,
        size: 200_000,
        cost: { amount: 0.17, currency: "USD" },
      },
      64,
    );
    collector.observeUpdate(
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Fixed the mock clock." },
      },
      70,
    );

    const obs = collector.finishTurn({
      sessionId: "sess-1",
      model: "claude-sonnet",
      stopReason: "end_turn",
    });

    expect(obs).toBeDefined();
    expect(obs?.turn).toBe(1);
    expect(obs?.durationMs).toBe(1_500);
    expect(obs?.observed.toolCallCount).toBe(3);
    expect(obs?.observed.toolWaves).toBe(2);
    expect(obs?.context.usedBefore).toBe(10_000);
    expect(obs?.context.usedAfter).toBe(14_500);
    expect(obs?.context.compacted).toBe(false);
    expect(obs?.cost).toEqual({ delta: 0.05, cumulative: 0.17, currency: "USD" });

    // Turn 2 with compaction_update
    now += 500;
    collector.startTurn("Continue");
    collector.observeUpdate(
      { sessionUpdate: "compaction_update", compactionId: "c1", status: "completed" },
      40,
    );
    collector.observeUpdate(
      {
        sessionUpdate: "usage_update",
        used: 4_000,
        size: 200_000,
        cost: { amount: 0.2, currency: "USD" },
      },
      64,
    );
    const obs2 = collector.finishTurn({
      sessionId: "sess-1",
      model: "claude-sonnet",
      stopReason: "end_turn",
    });
    expect(obs2?.context.compacted).toBe(true);
    expect(obs2?.context.usedBefore).toBe(14_500);
    expect(obs2?.context.usedAfter).toBe(4_000);
    expect(obs2?.cost?.delta).toBe(0.03);
  });

  it("captures PromptResponse.usage over live ACP even on stable SDK import", async () => {
    const observations: UsageTurnObservation[] = [];
    const app = agent({ name: "test-provider" })
      .onRequest(methods.agent.initialize, () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
      }))
      .onRequest(methods.agent.session.new, () => ({
        sessionId: "s-usage",
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "gpt-test",
            options: [{ value: "gpt-test", name: "GPT Test" }],
          },
        ],
      }))
      .onRequest(methods.agent.session.prompt, async ({ client }) => {
        await client.notify(methods.client.session.update, {
          sessionId: "s-usage",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "All done." },
          },
        });
        await client.notify(methods.client.session.update, {
          sessionId: "s-usage",
          update: {
            sessionUpdate: "usage_update",
            used: 2_500,
            size: 128_000,
            cost: { amount: 0.015, currency: "USD" },
          },
        });
        return {
          stopReason: "end_turn",
          usage: {
            inputTokens: 2_000,
            outputTokens: 500,
            cachedReadTokens: 1_200,
            thoughtTokens: 100,
            totalTokens: 2_500,
          },
        } as { stopReason: "end_turn" };
      });

    const session = await openSession(app, {
      cwd: "/tmp",
      agentName: "codex",
      usage: (obs) => observations.push(obs),
      usageAttribution: { surface: "relay", conversationId: "relay-1" },
    });
    try {
      const stop = await session.prompt("Say hello");
      expect(stop).toBe("end_turn");
    } finally {
      session.close();
    }

    expect(observations).toHaveLength(1);
    expect(observations[0]?.provider).toBe("codex");
    expect(observations[0]?.model).toBe("gpt-test");
    expect(observations[0]?.attribution).toEqual({ surface: "relay", conversationId: "relay-1" });
    expect(observations[0]?.reported).toEqual({
      inputTokens: 2_000,
      outputTokens: 500,
      cachedReadTokens: 1_200,
      thoughtTokens: 100,
      totalTokens: 2_500,
    });
    expect(observations[0]?.cost).toEqual({ delta: 0.015, cumulative: 0.015, currency: "USD" });
    expect(observations[0]?.context.usedAfter).toBe(2_500);
    expect(observations[0]?.observed.messageChars).toBe(9);
  });
});
