import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopWorkflows } from "../src/application/index.js";
import { startSchedulerRuntime } from "../src/automation/index.js";
import type {
  Automation,
  AutomationDraft,
  Execution,
  WorkflowList,
} from "../src/contracts/index.js";
import { type CoreDeps, defaultDeps } from "../src/core/index.js";
import { createWorkflowActionHandler } from "../src/gateway/workflow-automation.js";
import { FakeAgents } from "./fakes.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function makeGitRepo(root: string, name = "repo"): Promise<string> {
  const dir = join(root, name);
  await fs.mkdir(dir, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-b", "main");
  git("config", "user.email", "test@code60.dev");
  git("config", "user.name", "Code60 Test");
  await fs.writeFile(join(dir, "README.md"), "# Base\n");
  git("add", ".");
  git("commit", "-m", "init");
  return fs.realpath(dir);
}

describe("scheduled workflows integration", () => {
  it("runs a scheduled workflow from baseBranch, exposes it in DesktopWorkflows, and settles history", async () => {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "c60-swf-")));
    roots.push(root);
    const repo = await makeGitRepo(root);
    // Add an uncommitted dirty file in the source checkout; scheduled workflows must branch from refs/heads/main.
    await fs.writeFile(join(repo, "DIRTY.txt"), "uncommitted\n");

    const env = {
      ...process.env,
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_STATE_HOME: join(root, "state"),
    };

    const agents = new FakeAgents((text, session) => {
      if (text.includes("Independently verify")) {
        session.update({
          type: "message",
          text: JSON.stringify({
            kind: "verdict",
            decision: "accept",
            reason: "Verified cleanly",
          }),
        });
        return "end_turn";
      }
      const cwd = agents.specs[agents.sessions.indexOf(session)]?.cwd ?? "";
      // Worker writes a file in its isolated worktree and returns result JSON.
      void fs.writeFile(join(cwd, "OUTPUT.txt"), "scheduled-output\n").then(() => {
        session.update({
          type: "message",
          text: JSON.stringify({ kind: "result", summary: "Created OUTPUT.txt" }),
        });
        session.endTurn("end_turn");
      });
      return "hang";
    });
    const deps: CoreDeps = { ...defaultDeps(), agents };
    const resolveProvider = (providerId: string, cwd: string) => ({
      name: providerId,
      command: ["fake-claude"] as const,
      cwd,
    });
    const workflows = new DesktopWorkflows(
      env,
      deps,
      async () => null,
      async () => ({ message: "ok" }),
      {
        list: () => ({
          providers: [{ id: "claude", name: "Claude", ready: true }],
          defaultProvider: "claude",
        }),
        resolve: resolveProvider,
      },
    );
    const runtime = await startSchedulerRuntime(env, deps, {
      handlers: [
        createWorkflowActionHandler({
          deps,
          workflows,
          resolveProvider,
        }),
      ],
    });

    try {
      const draft: AutomationDraft = {
        name: "Nightly docs",
        enabled: false,
        trigger: {
          type: "schedule",
          schedule: { type: "daily", time: "09:00", timeZone: "UTC" },
        },
        action: {
          type: "workflow",
          provider: "claude",
          repository: repo,
          baseBranch: "main",
          tasks: [
            {
              name: "Write output",
              instructions: "Create OUTPUT.txt",
              verify: "OUTPUT.txt exists",
              checks: [],
            },
          ],
          repairs: 1,
          retries: 1,
          autoApprove: true,
        },
      };

      const job = (await runtime.request({ action: "create", draft })) as Automation;
      expect(job.action.type).toBe("workflow");

      const claim = (await runtime.request({ action: "runNow", id: job.id })) as Execution;
      expect(claim.actionType).toBe("workflow");
      expect(claim.artifact.type).toBe("workflow");

      // Wait until the scheduled workflow finishes.
      let settled: Execution | undefined;
      for (let i = 0; i < 100; i++) {
        settled = runtime.scheduler.execution(claim.id);
        if (settled.status === "finished" || settled.status === "failed") break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(settled?.status).toBe("finished");
      expect(settled?.artifact.type === "workflow" && settled.artifact.tasksCompleted).toBe(1);
      expect(settled?.artifact.type === "workflow" && settled.artifact.tasksTotal).toBe(1);

      // Verify the workflow appears natively in DesktopWorkflows with scheduled provenance and clean baseBranch.
      const wfList = (await workflows.request({ action: "list" })) as WorkflowList;
      expect(wfList.entries).toHaveLength(1);
      const record = wfList.entries[0];
      expect(record?.origin).toMatchObject({
        kind: "scheduled",
        automationId: job.id,
        automationName: "Nightly docs",
        executionId: claim.id,
      });
      expect(record?.baseBranch).toBe("main");
      expect(record?.snapshot?.status).toBe("completed");
      // The uncommitted DIRTY.txt in the source repo must NOT exist in the baseBranch worktree.
      await expect(fs.stat(join(record?.worktree ?? "", "DIRTY.txt"))).rejects.toThrow();

      // Verify diff evidence works via the scheduler.
      const diff = (await runtime.request({ action: "diff", executionId: claim.id })) as {
        text: string;
      };
      expect(diff.text).toContain("scheduled-output");
    } finally {
      await runtime.stop();
      await workflows.close();
    }
  });

  it("supports interactive needs_input approval in Workflows when autoApprove is false", async () => {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "c60-swf-perm-")));
    roots.push(root);
    const repo = await makeGitRepo(root);
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_STATE_HOME: join(root, "state"),
    };

    const agents = new FakeAgents((text, session) => {
      if (text.includes("Independently verify")) {
        session.update({
          type: "message",
          text: JSON.stringify({ kind: "verdict", decision: "accept", reason: "Good" }),
        });
        return "end_turn";
      }
      void session
        .requestPermission({
          toolCallId: "perm-1",
          title: "Run tool",
          kind: "execute",
          options: [{ optionId: "allow_once", name: "Allow once", kind: "allow_once" }],
        })
        .then((answer) => {
          expect(answer).toEqual({ optionId: "allow_once" });
          session.update({
            type: "message",
            text: JSON.stringify({ kind: "result", summary: "Done after approval" }),
          });
          session.endTurn("end_turn");
        });
      return "hang";
    });
    const deps: CoreDeps = { ...defaultDeps(), agents };
    const resolveProvider = (providerId: string, cwd: string) => ({
      name: providerId,
      command: ["fake-claude"] as const,
      cwd,
    });
    const workflows = new DesktopWorkflows(
      env,
      deps,
      async () => null,
      async () => ({ message: "ok" }),
      {
        list: () => ({
          providers: [{ id: "claude", name: "Claude", ready: true }],
          defaultProvider: "claude",
        }),
        resolve: resolveProvider,
      },
    );
    const runtime = await startSchedulerRuntime(env, deps, {
      handlers: [createWorkflowActionHandler({ deps, workflows, resolveProvider })],
    });

    try {
      const job = (await runtime.request({
        action: "create",
        draft: {
          name: "Manual gate WF",
          enabled: false,
          trigger: {
            type: "schedule",
            schedule: { type: "daily", time: "09:00", timeZone: "UTC" },
          },
          action: {
            type: "workflow",
            provider: "claude",
            repository: repo,
            baseBranch: "main",
            tasks: [{ name: "Step", instructions: "Do step", verify: "Check step", checks: [] }],
            repairs: 1,
            retries: 0,
            autoApprove: false,
          },
        },
      })) as Automation;

      const claim = (await runtime.request({ action: "runNow", id: job.id })) as Execution;

      // Wait for workflow to pause in needs_input in DesktopWorkflows.
      let pendingRecord: WorkflowList["entries"][number] | undefined;
      for (let i = 0; i < 100; i++) {
        const list = (await workflows.request({ action: "list" })) as WorkflowList;
        const candidate = list.entries[0];
        if (candidate?.snapshot?.status === "needs_input" && candidate.snapshot.decision) {
          pendingRecord = candidate;
          break;
        }
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(pendingRecord?.snapshot?.status).toBe("needs_input");
      // Scheduled job holds its lane slot while waiting (Option 1).
      expect(runtime.scheduler.status().activeExecutionIds).toEqual([claim.id]);

      // Answer the permission request directly via DesktopWorkflows (just like WorkflowPlayer).
      await workflows.request({
        action: "answer",
        id: pendingRecord?.id,
        questionId: pendingRecord?.snapshot?.decision?.id,
        answer: "allow_once",
      });

      // Both DesktopWorkflows and Scheduler settle to finished.
      let settled: Execution | undefined;
      for (let i = 0; i < 100; i++) {
        settled = runtime.scheduler.execution(claim.id);
        if (settled.status === "finished") break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(settled?.status).toBe("finished");
      expect(runtime.scheduler.status().activeExecutionIds).toEqual([]);
    } finally {
      await runtime.stop();
      await workflows.close();
    }
  });

  it("upgrades legacy format 1 state.json on disk cleanly without CAS errors", async () => {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "c60-swf-v1-")));
    roots.push(root);
    const repo = await makeGitRepo(root);
    const stat = await fs.stat(repo, { bigint: true });
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_STATE_HOME: join(root, "state"),
    };
    const autoDir = join(env.XDG_STATE_HOME, "code60", "automations");
    await fs.mkdir(autoDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      join(autoDir, "state.json"),
      `${JSON.stringify({
        format: 1,
        revision: 1,
        sequence: 0,
        pausedAll: false,
        block: null,
        automations: [
          {
            id: "00000000-0000-4000-8000-000000000010",
            revision: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            name: "Old Prompt",
            prompt: "Hello",
            agent: "claude",
            providerHash: "b".repeat(64),
            repository: { path: repo, dev: String(stat.dev), ino: String(stat.ino) },
            baseBranch: "main",
            allow: ["read"],
            turnTimeout: "10m",
            schedule: { type: "daily", time: "09:00", timeZone: "UTC" },
            enabled: false,
            nextRunAt: null,
          },
        ],
        executions: [],
      })}\n`,
      { mode: 0o600 },
    );

    const runtime = await startSchedulerRuntime(env, defaultDeps());
    try {
      const list = (await runtime.request({ action: "list" })) as Array<{
        name: string;
        actionType: string;
      }>;
      expect(list).toMatchObject([{ name: "Old Prompt", actionType: "prompt" }]);
      const savedDisk = JSON.parse(await fs.readFile(join(autoDir, "state.json"), "utf8")) as {
        format: number;
      };
      expect(savedDisk.format).toBe(2);
    } finally {
      await runtime.stop();
    }
  });
});
