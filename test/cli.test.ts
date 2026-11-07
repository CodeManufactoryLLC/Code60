import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/cli/run.js";
import type { SignalName } from "../src/cli/signals.js";
import { systemClock } from "../src/core/clock.js";
import type { CoreDeps } from "../src/core/index.js";
import { FakeAgents, FakeGit, FakeProcesses, type TurnScript } from "./fakes.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "code60-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function harness(script: TurnScript = () => "end_turn") {
  const agents = new FakeAgents(script);
  const git = new FakeGit();
  git.repoInfo = async () => ({
    topLevel: join(dir, "repo"),
    commonDir: join(dir, "repo", ".git"),
  });
  const signals = new EventEmitter();
  const out: string[] = [];
  const err: string[] = [];
  const deps: CoreDeps = {
    agents,
    git,
    fs: fs as unknown as CoreDeps["fs"],
    clock: systemClock,
    processes: new FakeProcesses(),
    ownerPid: process.pid,
  };
  const io = {
    stdout: { write: (s: string) => out.push(s), isTTY: false },
    stderr: { write: (s: string) => err.push(s), isTTY: false },
    env: {
      XDG_CONFIG_HOME: join(dir, "config"),
      XDG_STATE_HOME: join(dir, "state"),
    } as Record<string, string | undefined>,
    cwd: () => join(dir, "repo"),
    signals: {
      on: (s: SignalName, l: () => void) => signals.on(s, l),
      off: (s: SignalName, l: () => void) => signals.off(s, l),
    },
    deps,
  };
  return { agents, git, signals, io, stdout: () => out.join(""), stderr: () => err.join("") };
}

describe("code60 run (headless)", () => {
  it("--json writes only the result to stdout and progress to stderr", async () => {
    const h = harness((_t, s) => {
      s.update({
        type: "toolCall",
        toolCallId: "1",
        title: "Write hello.txt",
        kind: "edit",
        status: "pending",
      });
      return "end_turn";
    });
    h.git.files = [{ path: "hello.txt", status: "untracked" }];
    const code = await run(
      ["run", "--json", "--agent", "claude", "--agent", "codex", "secret prompt"],
      h.io,
    );
    expect(code).toBe(0);
    const result = JSON.parse(h.stdout());
    expect(result.runs).toHaveLength(2);
    expect(result.runs[0]).toEqual({
      id: expect.any(String),
      agent: "claude",
      status: "finished",
      reason: null,
      branch: expect.stringMatching(/^code60\//),
      worktree: expect.stringContaining(join(dir, "repo.worktrees")),
      changedFiles: 1,
    });
    expect(result.runs[1].agent).toBe("codex");
    expect(h.stderr()).toMatch(/\] running/);
    expect(h.stderr()).toMatch(/tool: Write hello.txt \(edit, pending\)/);
    expect(h.stderr()).toMatch(/\] finished/);
    expect(h.stderr()).not.toMatch(/secret prompt/);
  });

  it("--parallel N with one agent starts N runs of it at once", async () => {
    const h = harness(() => "hang");
    const done = run(["run", "--json", "--agent", "codex", "--parallel", "3", "go"], h.io);
    await vi.waitFor(() => expect(h.agents.sessions).toHaveLength(3));
    expect(h.agents.sessions).toHaveLength(3);
    h.signals.emit("SIGTERM");
    await done;
    const runs = JSON.parse(h.stdout()).runs as { agent: string }[];
    expect(runs.map((r) => r.agent)).toEqual(["codex", "codex", "codex"]);
  });

  it("--parallel caps active runs when several agents are named", async () => {
    const h = harness();
    expect(
      await run(
        ["run", "--json", "--agent", "claude", "--agent", "codex", "--parallel", "1", "go"],
        h.io,
      ),
    ).toBe(0);
    expect(JSON.parse(h.stdout()).runs).toHaveLength(2);
  });

  it.each([
    ["max_tokens", 1],
    ["cancelled", 130],
  ] as const)("exits with the code for stop reason %s", async (reason, exitCode) => {
    const h = harness(() => reason);
    expect(await run(["run", "--headless", "go"], h.io)).toBe(exitCode);
    expect(h.stdout()).toMatch(/not verified/);
  });

  it("exits 124 when a turn times out", async () => {
    const h = harness(() => "hang");
    expect(await run(["run", "--json", "--turn-timeout", "50ms", "go"], h.io)).toBe(124);
    expect(JSON.parse(h.stdout()).runs[0].status).toBe("timed_out");
  });

  it("on a signal, cancels every run, writes a partial result, and exits 130", async () => {
    const h = harness(() => "hang");
    const done = run(
      ["run", "--json", "--agent", "claude", "--agent", "codex", "--parallel", "1", "go"],
      h.io,
    );
    await vi.waitFor(() => expect(h.agents.sessions.length).toBeGreaterThan(0));
    h.signals.emit("SIGTERM");
    expect(await done).toBe(130);
    const statuses = JSON.parse(h.stdout()).runs.map((r: { status: string }) => r.status);
    expect(statuses).toEqual(["cancelled", "cancelled"]);
    expect(h.stderr()).toMatch(/interrupted; stopping every run/);
    expect(h.signals.listenerCount("SIGTERM")).toBe(0);
  });

  it.each([
    [["run", "--agent", "nobody", "go"], /unknown agent 'nobody'/],
    [["run", "--allow", "teleport", "go"], /unknown tool-call kind 'teleport'/],
    [["run", "--turn-timeout", "soon", "go"], /invalid duration/],
    [["run", "--turn-timeout", "9007199254740992ms", "go"], /duration must be a safe integer/],
    [["run"], /missing prompt/],
    [["run", "--parallel", "0", "go"], /--parallel must be a positive integer/],
    [["run", "--parallel", "33", "go"], /at most 32 runs/],
    [["run", "--base", "bad", "go"], /unknown revision 'bad'/],
    [["run", "--prompt-file", "/nonexistent/p.txt"], /cannot read the prompt file/],
    [["run", "--prompt-file", "/x", "inline"], /not both/],
  ])("exits 2 for %j", async (argv, message) => {
    const h = harness();
    expect(await run(argv, h.io)).toBe(2);
    expect(h.stderr()).toMatch(message);
    expect(h.stdout()).toBe("");
  });

  it("exits 2 for an invalid config file", async () => {
    const h = harness();
    await fs.mkdir(join(dir, "config", "code60"), { recursive: true });
    await writeFile(join(dir, "config", "code60", "config.json"), '{"maxParallel": -1}');
    expect(await run(["run", "go"], h.io)).toBe(2);
    expect(h.stderr()).toMatch(/maxParallel/);
  });
});

describe("code60 without a worktree", () => {
  it("runs outside a Git repository directly in the directory, and list finds the runs", async () => {
    const h = harness();
    h.git.repoInfo = async () => {
      throw new Error("not inside a Git working tree");
    };
    const code = await run(["run", "--json", "--agent", "claude", "--agent", "codex", "go"], h.io);
    expect(code).toBe(0);
    const { runs } = JSON.parse(h.stdout());
    expect(runs.map((r: { branch: unknown }) => r.branch)).toEqual([null, null]);
    expect(runs[0]).toMatchObject({ worktree: join(dir, "repo"), changedFiles: null });
    expect(h.agents.specs.map((s) => s.cwd)).toEqual([join(dir, "repo"), join(dir, "repo")]);
    expect(h.git.worktrees).toEqual([]);
    expect(h.stderr()).toMatch(/is not in a Git repository, so agents work directly in it/);
    expect(h.stderr()).toMatch(/all 2 runs share this directory/);
    expect(await fs.readdir(join(dir, "state", "code60", "dirs"))).toHaveLength(1);

    const later = harness();
    later.git.repoInfo = h.git.repoInfo;
    expect(await run(["list"], later.io)).toBe(0);
    expect(later.stdout()).toMatch(new RegExp(`^${runs[0].id} +claude +finished`, "m"));
    expect(await run(["diff", runs[0].id], later.io)).toBe(1);
    expect(later.stderr()).toMatch(/without a worktree/);
    expect(await run(["discard", "--yes", runs[0].id], later.io)).toBe(1);
    expect(later.stderr()).toMatch(/no worktree or branch to discard/);
  });

  it("runs in a repository with no commits directly in the directory", async () => {
    const h = harness();
    h.git.resolveCommit = async (_repo, rev) => {
      throw new Error(`unknown revision '${rev}'`);
    };
    expect(await run(["run", "go"], h.io)).toBe(0);
    expect(h.stderr()).toMatch(/is in a Git repository with no commits yet/);
    expect(h.stdout()).toMatch(/\(no worktree\)/);
    expect(h.stdout()).toMatch(/directory: .*repo \(no worktree\)/);
    expect(h.agents.specs[0]?.cwd).toBe(join(dir, "repo"));
    expect(await run(["run", "--base", "main", "go"], h.io)).toBe(2);
    expect(h.stderr()).toMatch(/unknown revision 'main'/);
  });

  it("exits 2 for --base outside a Git repository", async () => {
    const h = harness();
    h.git.repoInfo = async () => {
      throw new Error("not inside a Git working tree");
    };
    expect(await run(["run", "--base", "HEAD", "go"], h.io)).toBe(2);
    expect(h.stderr()).toMatch(/--base needs a Git repository/);
  });
});

describe("code60 list, diff, discard, stop", () => {
  it("keeps session metadata in records without adding it to CLI JSON", async () => {
    const h = harness((_text, session) => {
      session.update({
        type: "sessionState",
        state: {
          model: null,
          usage: { used: 5, size: 100, reportedAt: "2026-11-07T12:00:00.000Z" },
          modes: null,
        },
      });
      return "end_turn";
    });
    expect(await run(["run", "--json", "task"], h.io)).toBe(0);
    const result = JSON.parse(h.stdout()).runs[0];
    expect(result).not.toHaveProperty("sessionState");
    const record = JSON.parse(
      await fs.readFile(join(dir, "repo", ".git", "code60", "runs", result.id, "run.json"), "utf8"),
    );
    expect(record.sessionState.usage.used).toBe(5);
    const listing = harness();
    expect(await run(["list", "--json"], listing.io)).toBe(0);
    expect(JSON.parse(listing.stdout()).runs[0]).not.toHaveProperty("sessionState");
  });

  it("lists runs, diffs them, and requires --yes to discard without a terminal", async () => {
    const h = harness();
    await run(["run", "--json", "the prompt"], h.io);
    const id = JSON.parse(h.stdout()).runs[0].id as string;

    const list = harness();
    list.git.repoInfo = h.git.repoInfo;
    expect(await run(["list"], list.io)).toBe(0);
    expect(list.stdout()).toMatch(new RegExp(`^${id} +claude +finished +1 .* the prompt$`, "m"));

    const json = harness();
    json.git.repoInfo = h.git.repoInfo;
    expect(await run(["list", "--json"], json.io)).toBe(0);
    expect(JSON.parse(json.stdout()).runs[0]).toMatchObject({
      id,
      status: "finished",
      agentAlive: false,
    });

    const diff = harness();
    diff.git.repoInfo = h.git.repoInfo;
    expect(await run(["diff", id], diff.io)).toBe(0);
    expect(diff.stdout()).toMatch(/^diff --git/);

    const refuse = harness();
    refuse.git.repoInfo = h.git.repoInfo;
    refuse.git.files = [{ path: "a.txt", status: "modified" }];
    expect(await run(["discard", id], refuse.io)).toBe(2);
    expect(refuse.stderr()).toMatch(/modified +a.txt/);
    expect(refuse.stderr()).toMatch(/pass --yes/);
    expect(refuse.git.removed).toEqual([]);

    const yes = harness();
    yes.git.repoInfo = h.git.repoInfo;
    expect(await run(["discard", "--yes", id], yes.io)).toBe(0);
    expect(yes.git.removed).toEqual([
      { path: expect.stringContaining(id), branch: `code60/${id}` },
    ]);
    expect(yes.stdout()).toMatch(/Discarded run/);

    const stop = harness();
    stop.git.repoInfo = h.git.repoInfo;
    expect(await run(["stop", id], stop.io)).toBe(0);
    expect(stop.stdout()).toMatch(/no agent process is running/);
  });

  it("exits 2 for unknown or malformed run IDs", async () => {
    const h = harness();
    expect(await run(["diff", "nope"], h.io)).toBe(2);
    expect(h.stderr()).toMatch(/no run with ID 'nope'/);
    expect(await run(["discard", "--yes", "../../etc"], h.io)).toBe(2);
    expect(h.stderr()).toMatch(/invalid run ID/);
  });
});
