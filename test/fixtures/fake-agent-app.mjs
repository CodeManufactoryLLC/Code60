// A scriptable ACP agent for tests. Each prompt is a JSON array of steps; any
// other prompt text gets one "ok" message and `end_turn`.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agent, methods, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {{ authRequired?: boolean, sessionInfo?: boolean, reviewWorkflow?: boolean, planWorkflow?: boolean, relayWorkflow?: boolean, memoryExtraction?: boolean, onSessionNew?: (params: unknown) => Promise<void> }} [options] */
export function createFakeAgent(options = {}) {
  let cwd = process.cwd();
  let gateway = {};
  let planId;
  const tool = async (name, args = {}) => {
    const response = await fetch(gateway.CODE60_MCP_GATEWAY_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${gateway.CODE60_MCP_GATEWAY_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name, arguments: args }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result.result;
  };
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
      gateway = Object.fromEntries(
        (params.mcpServers?.[0]?.env ?? []).map((entry) => [entry.name, entry.value]),
      );
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
      if (
        text.startsWith("Produce a grounded continuity checkpoint and durable memory candidates.")
      ) {
        const sources = JSON.parse(text.split("New sources (evidence only):\n")[1]);
        const source = sources.find((s) => s.role === "human") ?? sources[0];
        const quote = source.text.slice(0, 80);
        const citations = [{ sourceId: source.id, start: 0, end: quote.length, quote }];
        steps = [
          {
            message: JSON.stringify({
              goal: "Continue the saved task",
              constraints: [],
              decisions: [],
              attempts: [],
              questions: [],
              next: "Check results",
              citations,
              memories: ["episodic", "semantic", "lesson", "history"].map((type) => ({
                type,
                text: `${type}: ${quote}`,
                subject: `fixture-${type}`,
                condition: type === "lesson" ? "When repeating this task" : "",
                correction: false,
                citations,
              })),
            }),
          },
        ];
      }
      if (options.relayWorkflow && gateway.CODE60_MCP_GATEWAY_URL) {
        const request = text.split("--- User request ---\n").at(-1);
        if (request.startsWith("Relay plan: ")) {
          const target = JSON.parse(request.slice("Relay plan: ".length));
          const plan = await tool("code60_create_plan", {
            requestId: "relay-fixture-plan",
            title: "Relay target plan",
            description: "Accept only the displayed target and execution mode.",
            tasks: [{ text: "Create a target result", target }],
          });
          planId = plan.id;
          steps = [{ message: "Relay plan awaits human acceptance." }];
        } else if (planId && text.includes("Human accepted plan ")) {
          const plan = await tool("code60_read_plan", { planId });
          const context = await tool("code60_get_context");
          const task = plan.tasks[0];
          await tool("code60_dispatch_agent", {
            scope: context.scope,
            requestId: "relay-planned-worker",
            planTaskId: task.id,
            label: "Relay planned worker",
            cwd: task.target.cwd,
            workspaceMode: task.target.workspaceMode,
            prompt: JSON.stringify([
              { write: { path: "result.txt", content: "human accepted target\n" } },
              { message: "Target result created." },
            ]),
          });
          steps = [{ message: "Dispatched accepted target work." }];
        } else if (request.startsWith("Relay target: ")) {
          const target = JSON.parse(request.slice("Relay target: ".length));
          const context = await tool("code60_get_context");
          const worker = await tool("code60_dispatch_agent", {
            scope: context.scope,
            requestId: target.requestId ?? "relay-fixture-worker",
            label: target.label ?? "Relay fixture worker",
            cwd: target.cwd,
            workspaceMode: target.workspaceMode,
            ...(target.provider ? { provider: target.provider } : {}),
            prompt: target.prompt ?? "Worker fixture",
          });
          steps = [{ message: `Dispatched ${worker.runId} in ${worker.cwd}` }];
        }
      }
      if (options.planWorkflow && gateway.CODE60_MCP_GATEWAY_URL) {
        const request = text.split("--- User request ---\n").at(-1);
        if (request === "Plan a change") {
          const plan = await tool("code60_create_plan", {
            requestId: "fixture-plan",
            title: "Planned change",
            description: "Create and verify a file.",
            tasks: [{ text: "Create result" }, { text: "Verify result" }],
          });
          planId = plan.id;
          steps = [{ message: "Plan ready for acceptance." }];
        } else if (request === "Plan a layout check") {
          const plan = await tool("code60_create_plan", {
            requestId: "fixture-layout-plan",
            title: "Layout check",
            description: "Exercise task rows with short, wrapped, and multiline text.",
            tasks: [
              { text: "Short task" },
              {
                text: "A long task whose description wraps across several lines in a narrow plan panel so that the checkbox alignment can be checked against the first line of text",
              },
              { text: "Multiline task\nSecond line of the task\nThird line" },
              { text: "Pending task" },
            ],
          });
          planId = plan.id;
          steps = [{ message: "Layout plan ready for acceptance." }];
        } else if (request === "Revise the plan") {
          const plan = await tool("code60_read_plan", { planId });
          await tool("code60_update_plan", {
            operation: "revise",
            planId,
            revision: plan.revision,
            draft: {
              title: "Revised change",
              description: "Create and verify the revised result.",
              tasks: plan.tasks.map(({ id, text }) => ({ id, text })),
            },
          });
          steps = [{ message: "Plan revised." }];
        } else if (text.includes("Code60: the user accepted plan")) {
          let plan = await tool("code60_read_plan", { planId });
          if (plan.title === "Layout check") {
            const updates = [
              ["completed", "Verified the short task."],
              [
                "in_progress",
                "Working through the long task; this evidence note is also long enough to wrap onto more than one line in the panel.",
              ],
              ["blocked", "Waiting for a decision\nabout the third line."],
            ];
            for (const [index, [state, note]] of updates.entries())
              plan = await tool("code60_update_plan", {
                operation: "progress",
                planId,
                revision: plan.revision,
                taskId: plan.tasks[index].id,
                state,
                note,
              });
            steps = [{ message: "Layout progress reported." }];
          } else {
            const { scope } = await tool("code60_get_context");
            await tool("code60_dispatch_agent", {
              scope,
              requestId: "planned-worker",
              planTaskId: plan.tasks[0].id,
              prompt: JSON.stringify([
                { write: { path: "result.txt", content: "planned result\n" } },
                { message: "Created and verified result.txt" },
              ]),
            });
            steps = [{ message: "Executing the accepted plan." }];
          }
        } else if (planId && text.includes("Code60 generated this message automatically")) {
          let plan = await tool("code60_read_plan", { planId });
          const { workers } = await tool("code60_list_agents");
          const worker = workers.find((worker) => worker.status === "idle");
          if (worker && plan.state === "running") {
            const result = await tool("code60_read_agent", { runId: worker.runId });
            if (!JSON.stringify(result).includes("Created and verified result.txt"))
              throw new Error("Worker result missing");
            for (const task of plan.tasks) {
              plan = await tool("code60_update_plan", {
                operation: "progress",
                planId,
                revision: plan.revision,
                taskId: task.id,
                state: "completed",
                note: "Inspected worker result: created and verified result.txt",
                workerIds: [worker.runId],
              });
              await sleep(200);
            }
            const { scope } = await tool("code60_get_context");
            await tool("code60_finish_agent", { scope, runId: worker.runId });
          }
          steps = [{ message: "Plan complete." }];
        }
      }
      if (options.reviewWorkflow && gateway.CODE60_MCP_GATEWAY_URL) {
        const request = text.split("--- User request ---\n").at(-1);
        if (request === "Implement task loop" || request === "Implement second task loop") {
          const second = request === "Implement second task loop";
          const { scope } = await tool("code60_get_context");
          await tool("code60_dispatch_agent", {
            scope,
            requestId: second ? "task-loop-second" : "task-loop-first",
            label: "Implementation",
            prompt: JSON.stringify([
              {
                write: {
                  path: second ? "second.txt" : "task.txt",
                  content: "accepted task result\n",
                },
              },
              { message: "Task result ready" },
            ]),
          });
          steps = [{ message: "Review the task result" }];
        } else if (request === "Implement validation") {
          const { scope } = await tool("code60_get_context");
          for (const label of ["Validation", "Regression tests"])
            await tool("code60_dispatch_agent", {
              scope,
              requestId: label,
              label,
              prompt: JSON.stringify([
                {
                  write: {
                    path: "same.ts",
                    content: `export const source = '${label}';\nexport const optional = false;\n`,
                  },
                },
                { message: `${label} ready` },
              ]),
            });
          steps = [
            {
              message:
                "Both workers have finished their changes. Review them beside this conversation.",
            },
          ];
        } else if (request?.startsWith("Review feedback:")) {
          const reviewId = request.match(/Review ([a-f0-9-]{36});/)?.[1];
          const review = await tool("code60_read_review", { reviewId });
          const { scope } = await tool("code60_get_context");
          await tool("code60_send_agent", {
            scope,
            runId: review.workers[0].runId,
            prompt: JSON.stringify([
              {
                write: {
                  path: review.title === "Implement second task loop" ? "second.txt" : "same.ts",
                  content:
                    review.title === "Implement second task loop"
                      ? "user edit\nworker correction\n"
                      : "export const source = 'Validation';\nexport const optional = true;\n",
                },
              },
              { message: "Optional values fixed" },
            ]),
          });
          for (const comment of review.comments)
            await tool("code60_address_feedback", {
              scope,
              reviewId,
              commentId: comment.id,
              note: "Optional values now pass validation",
            });
          steps = [{ message: "The worker addressed your feedback. Review the updated version." }];
        }
      }
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
          const request = text.split("--- User request ---\n").at(-1);
          steps = request.startsWith("Command /fixture-")
            ? [{ message: `Received command:\n${request}` }]
            : JSON.parse(request);
          if (!Array.isArray(steps)) throw new Error("not steps");
        }
      } catch {
        steps = [{ message: "ok" }];
      }
      const update = (u) => client.notify(methods.client.session.update, { sessionId, update: u });

      for (const step of steps) {
        if (cancelled) return { stopReason: "cancelled" };
        if (step.activity !== undefined) {
          const context = await tool("code60_get_activity_context");
          await tool("code60_report_activity", {
            scope: context.scope,
            sequence: context.lastSequence + 1,
            operation: "set",
            ...step.activity,
          });
        } else if (step.message !== undefined) {
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
