// External Transmission HTTP boundary for desktop journeys; never invokes a model.

import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

process.umask(0o077);
const root = process.argv[2];
mkdirSync(root, { recursive: true, mode: 0o700 });
const token = randomBytes(32).toString("hex");
const runs = new Map();
let sequence = 0;
const questionId = randomUUID();
function save() {
  writeFileSync(
    join(root, "fixture-runs.json"),
    JSON.stringify(
      [...runs.values()].map(({ worker, ...run }) => ({ ...run, workerPid: worker?.pid })),
    ),
    { mode: 0o600 },
  );
}
function event(run, kind, detail = {}) {
  run.events.push({ sequence: ++sequence, time: new Date().toISOString(), kind, detail });
}
function state(run) {
  const mode = existsSync(join(root, "control"))
    ? readFileSync(join(root, "control"), "utf8").trim()
    : "implementing";
  if (mode !== run.mode && !["cancelled", "completed"].includes(run.status)) {
    run.mode = mode;
    if (!["next_task", "completed"].includes(mode))
      event(run, mode, { task: run.plan.tasks[run.accepted.length]?.name });
    if (mode === "repairing")
      event(run, "verdict", {
        decision: "reject",
        reason: "Add the missing negative case",
        checks: [],
      });
    if (mode === "needs_input") {
      run.status = "needs_input";
      run.decision = {
        id: questionId,
        text: "Preserve negative zero?",
        options: [
          { id: "normalize", name: "Normalize to zero" },
          { id: "preserve", name: "Preserve sign" },
        ],
      };
    }
    if (mode === "completed" || mode === "next_task") {
      const target = mode === "completed" ? run.plan.tasks.length : 1;
      while (run.accepted.length < target) {
        const index = run.accepted.length;
        const task = run.plan.tasks[index];
        const accepted = {
          name: task.name,
          result: "Synthetic verified result",
          revision: "abc123",
          worker: `worker-${index}`,
          verifier: `verifier-${index}`,
          verdict: {
            decision: "accept",
            reason: "Independent fixture checks passed",
            checks: task.checks.map((command) => ({
              command,
              passed: true,
              evidence: "fixture pass",
            })),
          },
        };
        event(run, "task_accepted", accepted);
        run.accepted.push(accepted);
      }
      if (target === run.plan.tasks.length) {
        run.status = "completed";
        run.worker?.kill("SIGTERM");
      } else event(run, "turn_started", { role: "worker", task: run.plan.tasks[target].name });
    }
  }
  const terminal = ["cancelled", "completed", "failed"].includes(run.status);
  return {
    runId: run.id,
    status: run.status,
    tasks: run.plan.tasks.map((task, index) => ({
      index,
      name: task.name,
      state:
        index < run.accepted.length
          ? "accepted"
          : index > run.accepted.length
            ? "pending"
            : run.status === "cancelled"
              ? "cancelled"
              : ["paused", "pausing", "needs_input"].includes(run.status)
                ? run.status
                : ["repairing", "verifying"].includes(run.mode)
                  ? run.mode
                  : "implementing",
    })),
    activeTaskIndex: terminal ? null : run.accepted.length,
    eventCursor: run.events.at(-1)?.sequence ?? 0,
    ...(terminal ? {} : { phase: run.mode === "verifying" ? "verifier" : "worker" }),
    accepted: run.accepted,
    attempts: run.mode === "repairing" ? ["Verifier rejected the first candidate"] : [],
    ...(run.decision ? { decision: run.decision } : {}),
  };
}
const server = createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(403).end("{}");
    return;
  }
  const mode = existsSync(join(root, "control"))
    ? readFileSync(join(root, "control"), "utf8").trim()
    : "";
  if (mode === "disconnect") {
    res.writeHead(503).end("{}");
    return;
  }
  try {
    let body = "";
    for await (const chunk of req) body += chunk;
    const args = JSON.parse(body || "{}");
    const operation = req.url.slice(1);
    if (operation === "health") {
      res.end(JSON.stringify({ ready: true, pid: process.pid }));
      return;
    }
    let run = args.runId ? runs.get(args.runId) : undefined;
    if (operation === "start_workflow") {
      run = [...runs.values()].find((r) => r.plan.idempotencyKey === args.idempotencyKey);
      if (!run) {
        run = {
          id: randomUUID(),
          plan: args,
          status: "running",
          mode: "implementing",
          accepted: [],
          events: [],
        };
        run.worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
          stdio: "ignore",
        });
        writeFileSync(join(args.repository, "workflow-result.txt"), "isolated fixture result\n");
        runs.set(run.id, run);
        event(run, "started");
      }
    }
    if (!run) throw new Error("Unknown workflow");
    if (operation === "get_workflow_events") {
      res.end(
        JSON.stringify({ events: run.events.filter((e) => e.sequence > args.after).slice(0, 100) }),
      );
      return;
    }
    if (operation === "get_workflow_diff") {
      if (!run.accepted.length) {
        res.end(JSON.stringify({ content: "", nextOffset: null }));
        return;
      }
      res.end(
        JSON.stringify({
          content: Buffer.from(
            "diff --git a/workflow-result.txt b/workflow-result.txt\n+isolated fixture result\n",
          ).toString("base64"),
          revision: "abc123",
          nextOffset: null,
        }),
      );
      return;
    }
    if (operation === "pause_workflow" && run.status === "running") {
      run.status = "pausing";
      event(run, "pause_requested");
      if (run.worker && run.worker.exitCode === null && run.worker.signalCode === null) {
        await new Promise((resolve) => {
          run.worker.once("exit", resolve);
          run.worker.kill("SIGTERM");
        });
      }
      run.status = "paused";
      event(run, "paused");
    }
    if (operation === "resume_workflow" && run.status === "paused") {
      run.status = "running";
      event(run, "resumed");
      run.worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
    }
    if (operation === "cancel_workflow") {
      run.status = "cancelled";
      delete run.decision;
      if (run.worker && run.worker.exitCode === null && run.worker.signalCode === null)
        await new Promise((resolve) => {
          run.worker.once("exit", resolve);
          run.worker.kill("SIGTERM");
        });
      event(run, "cancelled");
      if (existsSync(join(root, "lose-stop-response")) && !run.lostStopReply) {
        run.lostStopReply = true;
        save();
        res.destroy();
        return;
      }
    }
    if (operation === "answer_workflow_question") {
      if (
        args.questionId !== questionId ||
        !run.decision ||
        !run.decision.options.some((option) => option.id === args.answer)
      )
        throw new Error("Stale question");
      run.status = "running";
      delete run.decision;
      event(run, "answered", { answer: args.answer });
      writeFileSync(join(root, "control"), "repairing");
    }
    if (operation === "send_workflow_message" && args.message === "reject guidance")
      throw new Error("Synthetic request rejection");
    if (operation === "send_workflow_message") event(run, "message", { message: args.message });
    const snapshot = state(run);
    save();
    res.end(JSON.stringify(snapshot));
  } catch {
    res.writeHead(400).end(JSON.stringify({ error: "Fixture request failed" }));
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
writeFileSync(join(root, "endpoint.json"), JSON.stringify({ port: server.address().port, token }), {
  mode: 0o600,
});
writeFileSync(join(root, "fixture-ready"), String(process.pid));
process.once("SIGTERM", () => {
  for (const run of runs.values()) run.worker?.kill("SIGTERM");
  server.close(() => process.exit(0));
});
