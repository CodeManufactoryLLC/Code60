import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentSession,
  type AgentSpec,
  AgentStartError,
  type Agents,
  type AgentUpdate,
  type PermissionHandler,
  type StopReason,
} from "../agents/index.js";
import {
  parseWorkflowAgentJson,
  WorkflowEngine,
  WorkflowProviderError,
} from "./workflow-engine.js";

const until = async (check: () => void) => vi.waitFor(check, { timeout: 10_000, interval: 20 });

interface TurnContext {
  sessionId: string;
  spec: AgentSpec;
  prompt: string;
  emit: (update: AgentUpdate) => void;
  askPermission: (request: Parameters<PermissionHandler>[0]) => ReturnType<PermissionHandler>;
}

type TurnHandler = (ctx: TurnContext) => Promise<StopReason | void> | StopReason | void;

function createStubAgents(handler: TurnHandler) {
  const started: { sessionId: string; spec: AgentSpec; stopped: boolean }[] = [];
  const agents: Agents = {
    async start(spec: AgentSpec) {
      const sessionId = randomUUID();
      const record = { sessionId, spec, stopped: false };
      started.push(record);
      const listeners = new Set<(update: AgentUpdate) => void>();
      let permHandler: PermissionHandler | undefined;
      let resolveExit: () => void = () => {};
      const exited = new Promise<void>((resolve) => {
        resolveExit = resolve;
      });
      const session: AgentSession = {
        sessionId,
        pid: 12345,
        exited,
        onUpdate(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        onPermission(fn) {
          permHandler = fn;
        },
        async prompt(text) {
          const emit = (u: AgentUpdate) => {
            for (const listener of listeners) listener(u);
          };
          const askPermission: TurnContext["askPermission"] = async (req) => {
            if (!permHandler) return "deny";
            return permHandler(req, new AbortController().signal);
          };
          const res = await handler({ sessionId, spec, prompt: text, emit, askPermission });
          return res ?? "end_turn";
        },
        async cancel() {},
        async stop() {
          record.stopped = true;
          resolveExit();
        },
        stderrTail: () => "",
      };
      return session;
    },
  };
  return { agents, started };
}

describe("WorkflowEngine", () => {
  let dir: string;
  let repo: string;
  let stateDir: string;
  let engine: WorkflowEngine | undefined;

  const resolveProvider = (providerId: string, cwd: string): AgentSpec => {
    if (providerId === "unknown") {
      throw new WorkflowProviderError(`Unknown provider: ${providerId}`);
    }
    return { name: providerId, command: ["fake-agent", providerId], cwd };
  };

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "code60-workflow-engine-")));
    repo = join(dir, "repo");
    stateDir = join(dir, "state");
    mkdirSync(stateDir, { recursive: true });
    execFileSync("git", ["init", "-q", repo]);
    writeFileSync(join(repo, "file.txt"), "initial\n");
    execFileSync("git", ["-C", repo, "add", "file.txt"]);
    execFileSync("git", [
      "-C",
      repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "initial",
    ]);
  });

  afterEach(async () => {
    await engine?.close();
    engine = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses direct JSON, trailing JSON after prose fences, and unfenced multi-line JSON", () => {
    expect(parseWorkflowAgentJson('{"kind":"result","summary":"ok"}')).toEqual({
      kind: "result",
      summary: "ok",
    });
    expect(
      parseWorkflowAgentJson(
        'Checked config:\n```json\n{"unrelated":true}\n```\n{"kind":"result","summary":"final"}',
      ),
    ).toEqual({ kind: "result", summary: "final" });
    expect(
      parseWorkflowAgentJson('Done.\n{\n  "kind": "result",\n  "summary": "multiline"\n}'),
    ).toEqual({ kind: "result", summary: "multiline" });
  });

  it("executes worker, handles verifier rejection with same-worker repair, accepts diff, and enforces provider idempotency", async () => {
    const workerSessions: string[] = [];
    let attempt = 0;
    const { agents } = createStubAgents(async ({ sessionId, prompt, emit }) => {
      const isWorker = prompt.startsWith("Implement");
      if (isWorker) {
        workerSessions.push(sessionId);
        attempt++;
        emit({ type: "message", text: "Working on task." });
        emit({
          type: "toolCall",
          toolCallId: "t1",
          title: "Write file",
          kind: "edit",
          status: "completed",
        });
        writeFileSync(join(repo, "out.txt"), `attempt-${attempt}\n`);
        emit({
          type: "message",
          text: JSON.stringify({ kind: "result", summary: `done-${attempt}` }),
        });
        return "end_turn" as const;
      }
      if (attempt === 1) {
        emit({
          type: "message",
          text: JSON.stringify({
            kind: "verdict",
            decision: "reject",
            reason: "Need attempt 2",
          }),
        });
        return "end_turn" as const;
      }
      emit({
        type: "message",
        text: JSON.stringify({
          kind: "verdict",
          decision: "accept",
          reason: "Verified attempt 2",
          checks: [{ command: "npm test", passed: true, evidence: "all green" }],
        }),
      });
      return "end_turn" as const;
    });

    engine = new WorkflowEngine(stateDir, agents, resolveProvider);
    const plan = {
      repository: repo,
      provider: "kiro",
      confirmed: true as const,
      idempotencyKey: "key-1",
      tasks: [
        {
          name: "Build feature",
          instructions: "Write out.txt",
          verify: "Verify out.txt",
          checks: ["npm test"],
        },
      ],
    };
    const started = engine.start(plan);
    expect(started.provider).toBe("kiro");
    expect(engine.start(plan).runId).toBe(started.runId);
    expect(() => engine?.start({ ...plan, provider: "codex" })).toThrow(
      "This key belongs to a different workflow.",
    );

    await until(() => expect(engine?.status(started.runId).status).toBe("completed"));
    const done = engine.status(started.runId);
    expect(done.provider).toBe("kiro");
    expect(done.result).toBe("done-2");
    expect(done.verdict?.decision).toBe("accept");
    // Same worker session handled the repair turn.
    expect(workerSessions).toHaveLength(2);
    expect(workerSessions[0]).toBe(workerSessions[1]);

    const diff = engine.diff(started.runId, 0);
    expect(Buffer.from(diff.content, "base64").toString("utf8")).toContain("attempt-2");
    const events = engine.events(started.runId, 0);
    expect(events.some((e) => e.kind === "repair_requested")).toBe(true);
    expect(events.some((e) => e.kind === "tool")).toBe(true);
  });

  it("handles permissions (autoApprove with allow_always, and manual permission choice)", async () => {
    const selected: unknown[] = [];
    const { agents } = createStubAgents(async ({ prompt, emit, askPermission }) => {
      if (prompt.startsWith("Implement")) {
        const answer = await askPermission({
          toolCallId: "p1",
          title: "Run tests",
          kind: "execute",
          options: [
            { optionId: "always-1", name: "Allow always", kind: "allow_always" },
            { optionId: "deny-1", name: "Deny", kind: "reject_once" },
          ],
        });
        selected.push(answer);
        emit({ type: "message", text: JSON.stringify({ kind: "result", summary: "ok" }) });
      } else {
        emit({
          type: "message",
          text: JSON.stringify({ kind: "verdict", decision: "accept", reason: "good" }),
        });
      }
      return "end_turn" as const;
    });

    engine = new WorkflowEngine(stateDir, agents, resolveProvider);
    const auto = engine.start({
      repository: repo,
      provider: "codex",
      confirmed: true,
      idempotencyKey: "perm-auto",
      autoApprove: true,
      tasks: [{ name: "T1", instructions: "I", verify: "V" }],
    });
    await until(() => expect(engine?.status(auto.runId).status).toBe("completed"));
    expect(selected[0]).toEqual({ optionId: "always-1" });

    const manual = engine.start({
      repository: repo,
      provider: "codex",
      confirmed: true,
      idempotencyKey: "perm-manual",
      autoApprove: false,
      tasks: [{ name: "T2", instructions: "I", verify: "V" }],
    });
    await until(() => expect(engine?.status(manual.runId).status).toBe("needs_input"));
    const decision = engine.status(manual.runId).decision;
    expect(decision?.options?.map((o) => o.id)).toEqual(["always-1", "deny-1"]);
    engine.answer(manual.runId, decision!.id, "always-1");
    await until(() => expect(engine?.status(manual.runId).status).toBe("completed"));
    expect(selected[1]).toEqual({ optionId: "always-1" });
  });

  it("fails fast without burning retries on AgentStartError with authRequired", async () => {
    let starts = 0;
    const agents: Agents = {
      async start() {
        starts++;
        throw new AgentStartError("Provider requires login", "", true);
      },
    };
    engine = new WorkflowEngine(stateDir, agents, resolveProvider);
    const run = engine.start({
      repository: repo,
      provider: "opencode",
      confirmed: true,
      idempotencyKey: "auth-fail",
      retries: 3,
      tasks: [{ name: "T1", instructions: "I", verify: "V" }],
    });
    await until(() => expect(engine?.status(run.runId).status).toBe("failed"));
    expect(starts).toBe(1);
    expect(engine.status(run.runId).attempts).toHaveLength(1);
    expect(engine.status(run.runId).reason).toContain("Provider requires login");
  });

  it("pauses cleanly, survives restart as paused, and resumes fresh", async () => {
    let hang = true;
    const { agents } = createStubAgents(async ({ prompt, emit }) => {
      if (hang) {
        await new Promise(() => {});
      }
      if (prompt.startsWith("Implement")) {
        emit({ type: "message", text: JSON.stringify({ kind: "result", summary: "resumed" }) });
      } else {
        emit({
          type: "message",
          text: JSON.stringify({ kind: "verdict", decision: "accept", reason: "ok" }),
        });
      }
      return "end_turn" as const;
    });

    engine = new WorkflowEngine(stateDir, agents, resolveProvider);
    const run = engine.start({
      repository: repo,
      provider: "claude",
      confirmed: true,
      idempotencyKey: "pause-1",
      retries: 0,
      tasks: [{ name: "Pause task", instructions: "I", verify: "V" }],
    });
    await until(() =>
      expect(engine?.events(run.runId, 0).some((e) => e.kind === "turn_started")).toBe(true),
    );
    const paused = await engine.pause(run.runId);
    expect(paused.status).toBe("paused");
    await engine.close();

    hang = false;
    engine = new WorkflowEngine(stateDir, agents, resolveProvider);
    expect(engine.status(run.runId).status).toBe("paused");
    engine.resume(run.runId);
    await until(() => expect(engine?.status(run.runId).status).toBe("completed"));
    expect(engine.status(run.runId).result).toBe("resumed");
  });
});
