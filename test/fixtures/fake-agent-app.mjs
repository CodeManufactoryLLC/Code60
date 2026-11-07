// A scriptable ACP agent for tests. Each prompt is a JSON array of steps; any
// other prompt text gets one "ok" message and `end_turn`.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agent, methods, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {{ authRequired?: boolean, sessionInfo?: boolean, memoryExtraction?: boolean, onSessionNew?: (params: unknown) => Promise<void> }} [options] */
export function createFakeAgent(options = {}) {
  let cwd = process.cwd();
  /** @type {Set<() => void>} */
  let cancelWaiters = new Set();
  let cancelled = false;
  let mode = "ask";
  const configOptions = () => [
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "fixture-model",
      options: [{ value: "fixture-model", name: "Fixture Model" }],
    },
    {
      id: "permissions",
      name: "Permissions",
      category: "mode",
      type: "select",
      currentValue: mode,
      options: [
        {
          group: "standard",
          name: "Standard",
          options: [
            { value: "ask", name: "Ask for approval" },
            { value: "full", name: "Full Access" },
          ],
        },
      ],
    },
  ];

  const waitForCancel = () =>
    cancelled ? Promise.resolve() : new Promise((resolve) => cancelWaiters.add(resolve));

  return agent({ name: "fake-agent" })
    .onRequest(methods.agent.initialize, () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {},
    }))
    .onRequest(methods.agent.session.new, async ({ params, client }) => {
      if (options.authRequired) throw RequestError.authRequired();
      cwd = params.cwd;
      await options.onSessionNew?.(params);
      if (options.sessionInfo)
        await client.notify(methods.client.session.update, {
          sessionId: "fake-session",
          update: { sessionUpdate: "usage_update", used: 53000, size: 200000 },
        });
      return {
        sessionId: "fake-session",
        ...(options.sessionInfo ? { configOptions: configOptions() } : {}),
      };
    })
    .onRequest(methods.agent.session.setConfigOption, ({ params }) => {
      if (
        !options.sessionInfo ||
        params.configId !== "permissions" ||
        !["ask", "full"].includes(params.value)
      )
        throw RequestError.invalidParams();
      mode = params.value;
      return { configOptions: configOptions() };
    })
    .onNotification(methods.agent.session.cancel, () => {
      cancelled = true;
      for (const resolve of cancelWaiters) resolve();
      cancelWaiters = new Set();
    })
    .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
      cancelled = false;
      const sessionId = params.sessionId;
      const text = params.prompt.map((b) => (b.type === "text" ? b.text : "")).join("");
      let steps;
      if (text.startsWith("Write a concise AI overview answering the search query")) {
        const data = JSON.parse(text.split("Search data (JSON):\n\n")[1]);
        const fileIndex = data.results.findIndex((source) => source.kind === "file");
        steps =
          data.query === "fixed"
            ? [{ hang: "cancellable" }]
            : [
                { sleep: 200 },
                {
                  message:
                    data.results.length === 0
                      ? "No project files or saved session evidence is available for this query."
                      : fileIndex >= 0
                        ? `Project overview: ${data.results[fileIndex].text} [${fileIndex + 1}]`
                        : data.results.every((source) => source.kind === "project")
                          ? "Only the project identity is available. No documentation or saved sessions found."
                          : "The recorded sessions report that the parser was fixed. [1]",
                },
              ];
      }
      if (options.memoryExtraction && text.startsWith("Code60 Episodic Memory extraction.")) {
        const instructions =
          text.split("Extraction instructions:\n\n")[1]?.split("\n\nReturn only")[0] ?? "";
        steps =
          instructions === "Wait for cancellation."
            ? [{ hang: "cancellable" }]
            : instructions === "Invalid response."
              ? [{ message: "not JSON" }]
              : [
                  {
                    message: JSON.stringify({
                      statements:
                        instructions === "Extract preferences only."
                          ? ["The user prefers concise responses."]
                          : ["The project uses npm.", "The release requires passing tests."],
                    }),
                  },
                ];
      }
      try {
        if (!steps) {
          // The orchestration role prepends its Operating Contract; scripts remain user input.
          steps = JSON.parse(text.split("--- User request ---\n").at(-1));
          if (!Array.isArray(steps)) throw new Error("not steps");
        }
      } catch {
        steps = [{ message: "ok" }];
      }
      const update = (u) => client.notify(methods.client.session.update, { sessionId, update: u });

      for (const step of steps) {
        if (cancelled) return { stopReason: "cancelled" };
        if (step.message !== undefined) {
          await update({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: step.message },
          });
        } else if (step.usage !== undefined) {
          await update({ sessionUpdate: "usage_update", ...step.usage });
        } else if (step.thought !== undefined) {
          await update({
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: step.thought },
          });
        } else if (step.tool !== undefined) {
          const { id, ...rest } = step.tool;
          await update({ sessionUpdate: "tool_call", toolCallId: id, ...rest });
        } else if (step.toolUpdate !== undefined) {
          const { id, ...rest } = step.toolUpdate;
          await update({ sessionUpdate: "tool_call_update", toolCallId: id, ...rest });
        } else if (step.unknownUpdate) {
          await update({ sessionUpdate: "plan", entries: [] });
        } else if (step.permission !== undefined) {
          const { id, title, kind, options: kinds } = step.permission;
          const offered = kinds ?? ["allow_once", "allow_always", "reject_once", "reject_always"];
          const response = await client.request(methods.client.session.requestPermission, {
            sessionId,
            toolCall: { toolCallId: id, title, ...(kind === undefined ? {} : { kind }) },
            options: offered.map((k) => ({ optionId: `opt-${k}`, name: k, kind: k })),
          });
          const outcome =
            response.outcome.outcome === "selected" ? response.outcome.optionId : "cancelled";
          await update({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `permission ${id}: ${outcome}` },
          });
        } else if (step.write !== undefined) {
          writeFileSync(join(cwd, step.write.path), step.write.content);
        } else if (step.stderr !== undefined) {
          process.stderr.write(step.stderr);
        } else if (step.sleep !== undefined) {
          await Promise.race([sleep(step.sleep), waitForCancel()]);
        } else if (step.hang === "cancellable") {
          await waitForCancel();
          return { stopReason: "cancelled" };
        } else if (step.hang === "stubborn") {
          process.on("SIGTERM", () => {});
          await new Promise(() => {});
        } else if (step.grandchild !== undefined) {
          const child = spawn(
            process.execPath,
            ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
            { stdio: "ignore" },
          );
          writeFileSync(step.grandchild, String(child.pid));
        } else if (step.exit !== undefined) {
          process.exit(step.exit);
        } else if (step.stop !== undefined) {
          return { stopReason: step.stop };
        }
      }
      return { stopReason: cancelled ? "cancelled" : "end_turn" };
    });
}
