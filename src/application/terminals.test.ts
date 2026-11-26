import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TERMINAL_LIMITS, type TerminalEvent } from "../bridge/index.js";
import type { OwnedPty } from "../platform/index.js";
import { ApplicationTerminals } from "./terminals.js";

function fakePty(pid = 1001, shell = "zsh") {
  let exitResolve!: (value: { code: number | null; signal: string | null }) => void;
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    exitResolve = resolve;
  });
  const listeners = new Set<(chunk: string) => void>();
  let done = false;
  const finish = (code: number | null = 0, signal: string | null = null) => {
    if (done) return;
    done = true;
    exitResolve({ code, signal });
  };
  const pty: OwnedPty = {
    pid,
    shell,
    write: vi.fn(),
    resize: vi.fn(),
    onData: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    exited,
    hasExited: () => done,
    stop: vi.fn(async () => finish(null, "SIGTERM")),
  };
  return {
    pty,
    emit(chunk: string) {
      for (const listener of listeners) listener(chunk);
    },
    finish,
  };
}

describe("ApplicationTerminals", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function dir() {
    const path = await mkdtemp(join(tmpdir(), "code60-app-terminals-"));
    dirs.push(path);
    return path;
  }

  it("opens, lists, forwards coalesced output, handles write/resize, and notifies changes", async () => {
    const cwd = await dir();
    const fake = fakePty(4242, "bash");
    const manager = new ApplicationTerminals({}, async () => fake.pty);
    const events: TerminalEvent[] = [];
    let changes = 0;
    manager.subscribe((event) => events.push(event));
    manager.subscribeChanges(() => changes++);

    const info = await manager.open(
      {
        cwd,
        label: "Worker 1",
        project: "/repo",
        projectId: "11111111-1111-4111-8111-111111111111",
        targetKind: "project-worker",
        runId: "run-1",
        databaseOwned: true,
      },
      90,
      30,
    );

    expect(info.pid).toBe(4242);
    expect(info.shell).toBe("bash");
    expect(manager.list()).toHaveLength(1);
    expect(changes).toBe(1);

    manager.write({ id: info.id, data: "ls\n" });
    manager.resize({ id: info.id, cols: 120, rows: 40 });
    expect(fake.pty.write).toHaveBeenCalledWith("ls\n");
    expect(fake.pty.resize).toHaveBeenCalledWith(120, 40);

    fake.emit("hello ");
    fake.emit("world");
    await vi.waitFor(() =>
      expect(events).toContainEqual({ id: info.id, type: "data", data: "hello world" }),
    );

    fake.finish(0, null);
    await vi.waitFor(() =>
      expect(events).toContainEqual({ id: info.id, type: "exit", code: 0, signal: null }),
    );
    expect(manager.list()).toEqual([]);
    expect(changes).toBe(2);
  });

  it("enforces session limit and rejects missing directories", async () => {
    const cwd = await dir();
    let nextPid = 100;
    const manager = new ApplicationTerminals({}, async () => fakePty(++nextPid).pty);
    await expect(
      manager.open(
        {
          cwd: join(cwd, "missing"),
          label: "Relay",
          project: null,
          projectId: null,
          targetKind: "relay",
          runId: null,
          databaseOwned: false,
        },
        80,
        24,
      ),
    ).rejects.toThrow("no longer available");

    for (let i = 0; i < TERMINAL_LIMITS.maxSessions; i++) {
      await manager.open(
        {
          cwd,
          label: `Term ${i}`,
          project: null,
          projectId: null,
          targetKind: "relay",
          runId: null,
          databaseOwned: false,
        },
        80,
        24,
      );
    }
    await expect(
      manager.open(
        {
          cwd,
          label: "Overflow",
          project: null,
          projectId: null,
          targetKind: "relay",
          runId: null,
          databaseOwned: false,
        },
        80,
        24,
      ),
    ).rejects.toThrow("Maximum of 16 concurrent terminals");
    await manager.closeAll(true);
    expect(manager.list()).toEqual([]);
  });

  it("supports scoped closeByRun, closeByProject, and closeDatabaseOwned", async () => {
    const cwd = await dir();
    let nextPid = 200;
    const manager = new ApplicationTerminals({}, async () => fakePty(++nextPid).pty);
    const projectId = "22222222-2222-4222-8222-222222222222";
    const w1 = await manager.open(
      {
        cwd,
        label: "Worker 1",
        project: "/repo",
        projectId,
        targetKind: "project-worker",
        runId: "run-1",
        databaseOwned: true,
      },
      80,
      24,
    );
    const p1 = await manager.open(
      {
        cwd,
        label: "Project",
        project: "/repo",
        projectId,
        targetKind: "project",
        runId: null,
        databaseOwned: true,
      },
      80,
      24,
    );
    const r1 = await manager.open(
      {
        cwd,
        label: "Relay",
        project: null,
        projectId: null,
        targetKind: "relay",
        runId: null,
        databaseOwned: false,
      },
      80,
      24,
    );

    await manager.closeByRun("run-1");
    expect(manager.list().map((entry) => entry.id)).toEqual([p1.id, r1.id]);

    const p2 = await manager.open(
      {
        cwd,
        label: "Other Project",
        project: "/repo2",
        projectId: "33333333-3333-4333-8333-333333333333",
        targetKind: "project",
        runId: null,
        databaseOwned: true,
      },
      80,
      24,
    );
    await manager.closeByProject(projectId);
    expect(manager.list().map((entry) => entry.id)).toEqual([r1.id, p2.id]);

    await manager.closeDatabaseOwned();
    expect(manager.list().map((entry) => entry.id)).toEqual([r1.id]);

    await manager.close({ id: w1.id });
    await manager.close({ id: r1.id });
    expect(manager.list()).toEqual([]);
  });
});
