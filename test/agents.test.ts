import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AgentSession,
  type AgentUpdate,
  createAgents,
  openSession,
  type PermissionRequest,
} from "../src/agents/index.js";
import { createFakeAgent } from "./fixtures/fake-agent-app.mjs";

const FAKE_AGENT = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/fake-agent.mjs");
const steps = (...s: unknown[]) => JSON.stringify(s);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("ACP client (in process)", () => {
  it("captures every raw update alongside typed updates and returns the stop reason", async () => {
    const session = await openSession(createFakeAgent(), { cwd: "/tmp", agentName: "fake" });
    const updates: AgentUpdate[] = [];
    session.onUpdate((u) => updates.push(u));
    const reason = await session.prompt(
      steps(
        { message: "hello" },
        { thought: "hmm" },
        { unknownUpdate: true },
        { tool: { id: "t1", title: "Read a.txt", kind: "read", status: "in_progress" } },
        { toolUpdate: { id: "t1", status: "completed" } },
        { tool: { id: "t2", title: "Weird", kind: "teleport" } },
        { stop: "max_tokens" },
      ),
    );
    expect(reason).toBe("max_tokens");
    const raw = updates.filter((u) => u.type === "acp");
    expect(raw.map((u) => u.update)).toEqual([
      "agent_message_chunk",
      "agent_thought_chunk",
      "plan",
      "tool_call",
      "tool_call_update",
      "tool_call",
    ]);
    expect(JSON.parse(raw[2]?.payload ?? "")).toEqual({ sessionUpdate: "plan", entries: [] });
    for (const update of raw) {
      expect(update.size).toBe(Buffer.byteLength(update.payload));
      expect(update.truncated).toBeUndefined();
    }
    expect(updates.map((u) => u.type)).toEqual([
      "acp",
      "message",
      "acp",
      "thought",
      "acp",
      "acp",
      "toolCall",
      "acp",
      "toolCall",
      "acp",
      "toolCall",
    ]);
    expect(updates.filter((u) => u.type !== "acp")).toEqual([
      { type: "message", text: "hello" },
      { type: "thought", text: "hmm" },
      {
        type: "toolCall",
        toolCallId: "t1",
        title: "Read a.txt",
        kind: "read",
        status: "in_progress",
      },
      {
        type: "toolCall",
        toolCallId: "t1",
        title: "Read a.txt",
        kind: "read",
        status: "completed",
      },
      { type: "toolCall", toolCallId: "t2", title: "Weird", kind: "other", status: "pending" },
    ]);
    session.close();
  });

  it("picks only the once options and cancels when no matching option exists", async () => {
    const session = await openSession(createFakeAgent(), { cwd: "/tmp", agentName: "fake" });
    const requests: PermissionRequest[] = [];
    session.onPermission(async (req) => {
      requests.push(req);
      return req.toolCallId === "p1" || req.toolCallId === "p3" ? "allow" : "deny";
    });
    const messages: string[] = [];
    session.onUpdate((u) => {
      if (u.type === "message") messages.push(u.text);
    });
    await session.prompt(
      steps(
        { permission: { id: "p1", title: "Edit a", kind: "edit" } },
        { permission: { id: "p2", title: "Run rm" } },
        {
          permission: {
            id: "p3",
            title: "Only always",
            kind: "execute",
            options: ["allow_always"],
          },
        },
      ),
    );
    const option = (kind: string) => ({ optionId: `opt-${kind}`, name: kind, kind });
    expect(requests.map(({ options: _, ...request }) => request)).toEqual([
      { toolCallId: "p1", title: "Edit a", kind: "edit" },
      { toolCallId: "p2", title: "Run rm", kind: "other" },
      { toolCallId: "p3", title: "Only always", kind: "execute" },
    ]);
    expect(requests.map((request) => request.options)).toEqual([
      ["allow_once", "allow_always", "reject_once", "reject_always"].map(option),
      ["allow_once", "allow_always", "reject_once", "reject_always"].map(option),
      ["allow_always"].map(option),
    ]);
    expect(messages).toEqual([
      "permission p1: opt-allow_once",
      "permission p2: opt-reject_once",
      "permission p3: cancelled",
    ]);
    session.close();
  });

  it("rejects a prompt while a turn is in progress, and cancel ends the turn", async () => {
    const session = await openSession(createFakeAgent(), { cwd: "/tmp", agentName: "fake" });
    const first = session.prompt(steps({ hang: "cancellable" }));
    await expect(session.prompt("again")).rejects.toThrow(/already in progress/);
    await session.cancel();
    expect(await first).toBe("cancelled");
    expect(await session.prompt("next")).toBe("end_turn");
    session.close();
  });

  it("withdraws a pending permission request on cancel", async () => {
    const session = await openSession(createFakeAgent(), { cwd: "/tmp", agentName: "fake" });
    let withdrawn = false;
    session.onPermission(
      (_req, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            withdrawn = true;
            resolve("allow");
          });
        }),
    );
    const messages: string[] = [];
    session.onUpdate((u) => {
      if (u.type === "message") messages.push(u.text);
    });
    const turn = session.prompt(steps({ permission: { id: "p", title: "x", kind: "edit" } }));
    await new Promise((r) => setTimeout(r, 20));
    await session.cancel();
    expect(await turn).toBe("cancelled");
    expect(withdrawn).toBe(true);
    expect(messages).toEqual(["permission p: cancelled"]);
    session.close();
  });

  it("reports an authentication requirement clearly", async () => {
    await expect(
      openSession(createFakeAgent({ authRequired: true }), { cwd: "/tmp", agentName: "claude" }),
    ).rejects.toThrow("log in through claude's own CLI");
  });
});

describe("agent processes", () => {
  let dir: string;
  const sessions: AgentSession[] = [];

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "code60-agent-")));
  });

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((s) => s.stop(0)));
    await rm(dir, { recursive: true, force: true });
  });

  async function start(env: Record<string, string> = {}): Promise<AgentSession> {
    const session = await createAgents({ clientVersion: "0.0.0-test" }).start({
      name: "fake",
      command: [process.execPath, FAKE_AGENT],
      cwd: dir,
      env: { ...(process.env as Record<string, string>), ...env },
    });
    sessions.push(session);
    return session;
  }

  it("runs turns in the worktree and keeps the agent alive between them", async () => {
    const session = await start();
    expect(await session.prompt(steps({ write: { path: "hello.txt", content: "hi" } }))).toBe(
      "end_turn",
    );
    expect(await readFile(join(dir, "hello.txt"), "utf8")).toBe("hi");
    expect(alive(session.pid)).toBe(true);
    expect(await session.prompt("again")).toBe("end_turn");
  });

  it("keeps a bounded stderr tail", async () => {
    const session = await start({ FAKE_AGENT_STDERR: `${"x".repeat(70 * 1024)}END` });
    await session.prompt("hi");
    // stdout and stderr are separate pipes, so the turn can end before all of stderr is read.
    await vi.waitFor(() => expect(session.stderrTail().endsWith("END")).toBe(true));
    expect(session.stderrTail().length).toBe(64 * 1024);
  });

  it("fails the turn when the agent exits", async () => {
    const session = await start();
    await expect(session.prompt(steps({ exit: 3 }))).rejects.toThrow(/exited with code 3|closed/);
  });

  it("reports the auth error from a real process", async () => {
    await expect(start({ FAKE_AGENT_AUTH: "1" })).rejects.toThrow(/log in through fake's own CLI/);
  });

  it("fails clearly when the command does not exist", async () => {
    await expect(
      createAgents({ clientVersion: "0.0.0-test" }).start({
        name: "nope",
        command: ["code60-no-such-agent"],
        cwd: dir,
      }),
    ).rejects.toThrow(/could not start 'code60-no-such-agent'/);
  });

  it("kills the whole process group, including a grandchild that ignores SIGTERM", async () => {
    const session = await start();
    const pidFile = join(dir, "grandchild.pid");
    const turn = session.prompt(steps({ grandchild: pidFile }, { hang: "stubborn" }));
    turn.catch(() => {});
    let grandchild = 0;
    for (let i = 0; i < 100 && grandchild === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
      grandchild = Number(await readFile(pidFile, "utf8").catch(() => "0"));
    }
    expect(alive(grandchild)).toBe(true);
    const started = Date.now();
    await session.stop(300);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(alive(session.pid)).toBe(false);
    expect(alive(grandchild)).toBe(false);
    await expect(turn).rejects.toThrow();
  });
});
