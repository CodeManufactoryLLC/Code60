import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HEARTBEAT_POLICY,
  HEARTBEAT_ACTIONS,
  type HeartbeatActionDefinition,
} from "../contracts/index.js";
import type { Git, GitWorktree } from "../git/index.js";
import {
  auditAndPruneWorktrees,
  type CoreDeps,
  checkAndCleanOrphans,
  cleanStaleTempArtifacts,
  defaultDeps,
  openWorkspace,
  reconcileWorkspaceRuns,
  runHeartbeatSweep,
  type TempCleanupFs,
} from "./index.js";
import type { RunRecord } from "./types.js";

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function makeFakeDeps(
  repoDir: string,
  commonDir: string,
  overrides: {
    nowMs?: number;
    worktrees?: GitWorktree[];
    changedByWorktree?: Record<string, Array<{ path: string; status: "modified" }>>;
    alivePids?: Set<number>;
    aliveGroups?: Set<number>;
    commandLines?: Record<number, string>;
    removed?: Array<{ repoDir: string; path: string; branch: string }>;
  } = {},
): CoreDeps {
  const base = defaultDeps();
  const nowMs = overrides.nowMs ?? Date.parse("2026-11-27T12:00:00.000Z");
  const alivePids = overrides.alivePids ?? new Set<number>();
  const aliveGroups = overrides.aliveGroups ?? new Set<number>();
  const commandLines = overrides.commandLines ?? {};
  const removed = overrides.removed ?? [];

  const git: Git = {
    async repoInfo() {
      return { topLevel: repoDir, commonDir };
    },
    async listWorktrees() {
      return overrides.worktrees ?? [];
    },
    async resolveCommit() {
      return "a".repeat(40);
    },
    async addWorktree() {},
    async removeWorktree(repo, path, branch) {
      removed.push({ repoDir: repo, path, branch });
    },
    async diff() {
      return "";
    },
    async changedFiles(worktree) {
      return overrides.changedByWorktree?.[worktree] ?? [];
    },
  };

  return {
    ...base,
    git,
    clock: {
      now: () => new Date(nowMs),
      setTimeout: base.clock.setTimeout,
      clearTimeout: base.clock.clearTimeout,
    },
    processes: {
      isAlive: (pid) => alivePids.has(pid),
      groupAlive: (pgid) => aliveGroups.has(pgid),
      commandLine: async (pid) => commandLines[pid],
      signalGroup(pgid) {
        aliveGroups.delete(pgid);
      },
    },
  };
}

describe("core heartbeat engine", () => {
  it("reconciles dead-owner active runs in maintain mode and only counts in inspect mode", async () => {
    const root = await makeTempDir("code60-hb-reconcile-");
    const common = join(root, ".git");
    const deps = makeFakeDeps(root, common, { alivePids: new Set([1001]) });
    const workspace = await openWorkspace(deps, root, {});

    const aliveRecord: RunRecord = {
      id: "run-alive",
      agent: "claude",
      status: "running",
      firstPrompt: "hi",
      turns: 1,
      base: "a".repeat(40),
      branch: "code60/run-alive",
      worktree: join(root, "wt-alive"),
      ownerPid: 1001,
      startedAt: "2026-11-27T10:00:00.000Z",
    };
    const deadRecord: RunRecord = {
      ...aliveRecord,
      id: "run-dead",
      branch: "code60/run-dead",
      worktree: join(root, "wt-dead"),
      ownerPid: 9999,
    };
    await workspace.store.save(aliveRecord);
    await workspace.store.save(deadRecord);

    const inspected = await reconcileWorkspaceRuns(deps, root, {}, "inspect");
    expect(inspected.candidateCount).toBe(1);
    expect(inspected.reconciledCount).toBe(0);
    expect((await workspace.store.read("run-dead")).status).toBe("running");

    const maintained = await reconcileWorkspaceRuns(deps, root, {}, "maintain");
    expect(maintained.reconciledCount).toBe(1);
    expect((await workspace.store.read("run-dead")).status).toBe("interrupted");
    expect((await workspace.store.read("run-alive")).status).toBe("running");
  });

  it("stops verified orphan agents and escalates unverified orphans", async () => {
    const root = await makeTempDir("code60-hb-orphan-");
    const common = join(root, ".git");
    const aliveGroups = new Set([4001, 4002]);
    const deps = makeFakeDeps(root, common, {
      aliveGroups,
      commandLines: {
        4001: "claude --acp",
        4002: "unrelated-process --other",
      },
    });
    const workspace = await openWorkspace(deps, root, {});

    await workspace.store.save({
      id: "run-verified",
      agent: "claude",
      status: "interrupted",
      firstPrompt: "x",
      turns: 1,
      base: "a".repeat(40),
      branch: "code60/run-verified",
      worktree: join(root, "wt-1"),
      ownerPid: 1,
      agentPid: 4001,
      agentCommandLine: "claude --acp",
      startedAt: "2026-11-27T08:00:00.000Z",
      endedAt: "2026-11-27T08:05:00.000Z",
    });
    await workspace.store.save({
      id: "run-mismatched",
      agent: "claude",
      status: "interrupted",
      firstPrompt: "x",
      turns: 1,
      base: "a".repeat(40),
      branch: "code60/run-mismatched",
      worktree: join(root, "wt-2"),
      ownerPid: 1,
      agentPid: 4002,
      agentCommandLine: "claude --acp",
      startedAt: "2026-11-27T08:00:00.000Z",
      endedAt: "2026-11-27T08:05:00.000Z",
    });

    const result = await checkAndCleanOrphans(
      deps,
      root,
      {},
      {
        mode: "maintain",
        autoStopVerifiedOrphans: true,
      },
    );
    expect(result.stoppedCount).toBe(1);
    expect(result.escalatedCount).toBe(1);
    expect(aliveGroups.has(4001)).toBe(false);
    expect(aliveGroups.has(4002)).toBe(true);
    expect(new Set(result.findings.map((f) => f.code))).toEqual(
      new Set(["orphan_agent_stopped", "orphan_agent_unverified"]),
    );
  });

  it("enforces all 7 safety guards when pruning clean worktrees", async () => {
    const root = await makeTempDir("code60-hb-wt-");
    const common = join(root, ".git");
    const nowMs = Date.parse("2026-11-27T12:00:00.000Z");
    const oldEnd = "2026-11-25T10:00:00.000Z";
    const freshEnd = "2026-11-27T11:30:00.000Z";

    const wtCleanOld = join(root, "wt-clean-old");
    const wtDirtyOld = join(root, "wt-dirty-old");
    const wtFresh = join(root, "wt-fresh");
    const wtPinned = join(root, "wt-pinned");
    const wtLiveAgent = join(root, "wt-live-agent");
    const wtUserBranch = join(root, "wt-user-branch");

    const removed: Array<{ repoDir: string; path: string; branch: string }> = [];
    const deps = makeFakeDeps(root, common, {
      nowMs,
      removed,
      aliveGroups: new Set([5555]),
      worktrees: [
        { path: wtCleanOld, branch: "code60/run-clean-old", createdAt: oldEnd, sizeBytes: null },
        { path: wtDirtyOld, branch: "code60/run-dirty-old", createdAt: oldEnd, sizeBytes: null },
        { path: wtFresh, branch: "code60/run-fresh", createdAt: freshEnd, sizeBytes: null },
        { path: wtPinned, branch: "code60/run-pinned", createdAt: oldEnd, sizeBytes: null },
        { path: wtLiveAgent, branch: "code60/run-live", createdAt: oldEnd, sizeBytes: null },
        { path: wtUserBranch, branch: "feature/user-work", createdAt: oldEnd, sizeBytes: null },
      ],
      changedByWorktree: {
        [wtCleanOld]: [],
        [wtDirtyOld]: [{ path: "src/app.ts", status: "modified" }],
        [wtFresh]: [],
        [wtPinned]: [],
        [wtLiveAgent]: [],
      },
    });
    const workspace = await openWorkspace(deps, root, {});

    const baseRecord = {
      agent: "claude",
      status: "finished" as const,
      firstPrompt: "task",
      turns: 1,
      base: "a".repeat(40),
      ownerPid: 1,
      startedAt: oldEnd,
      endedAt: oldEnd,
    };
    await workspace.store.save({
      ...baseRecord,
      id: "run-clean-old",
      branch: "code60/run-clean-old",
      worktree: wtCleanOld,
    });
    await workspace.store.save({
      ...baseRecord,
      id: "run-dirty-old",
      branch: "code60/run-dirty-old",
      worktree: wtDirtyOld,
    });
    await workspace.store.save({
      ...baseRecord,
      id: "run-fresh",
      branch: "code60/run-fresh",
      worktree: wtFresh,
      endedAt: freshEnd,
    });
    await workspace.store.save({
      ...baseRecord,
      id: "run-pinned",
      branch: "code60/run-pinned",
      worktree: wtPinned,
    });
    await workspace.store.save({
      ...baseRecord,
      id: "run-live",
      branch: "code60/run-live",
      worktree: wtLiveAgent,
      agentPid: 5555,
    });

    const result = await auditAndPruneWorktrees(
      deps,
      root,
      {},
      {
        mode: "maintain",
        autoPruneCleanWorktrees: true,
        minAgeHours: 24,
        pinnedWorktrees: new Set([wtPinned]),
      },
    );

    expect(result.prunedCount).toBe(1);
    expect(result.dirtyRetainedCount).toBe(1);
    expect(removed).toEqual([{ repoDir: root, path: wtCleanOld, branch: "code60/run-clean-old" }]);
    // run.json preserved with discardedAt stamped
    const updated = await workspace.store.read("run-clean-old");
    expect(updated.discardedAt).toBe("2026-11-27T12:00:00.000Z");
  });

  it("cleans stale code60-index-* temp dirs and private .tmp files without touching symlinks or fresh items", async () => {
    const nowMs = Date.parse("2026-11-27T12:00:00.000Z");
    const removedPaths: string[] = [];
    const fsOps: TempCleanupFs = {
      async readdir(dir) {
        if (dir === "/tmp")
          return ["code60-index-old", "code60-index-new", "code60-index-link", "other"];
        return ["abc.tmp", "fresh.tmp", ".writer.tmp", "state.json"];
      },
      async lstat(path) {
        const old =
          path.includes("old") || path.endsWith("abc.tmp") || path.endsWith(".writer.tmp");
        const isLink = path.includes("link");
        const isDir = path.startsWith("/tmp/code60-index-");
        return {
          isDirectory: () => isDir && !isLink,
          isFile: () => !isDir && !isLink,
          isSymbolicLink: () => isLink,
          mtimeMs: old ? nowMs - 2 * 60 * 60_000 : nowMs - 5 * 60_000,
        };
      },
      async rm(path) {
        removedPaths.push(path);
      },
    };

    const result = await cleanStaleTempArtifacts(
      "/tmp",
      ["/state/heartbeat"],
      nowMs,
      "maintain",
      fsOps,
    );
    expect(result.cleanedCount).toBe(2);
    expect(removedPaths).toEqual(["/tmp/code60-index-old", "/state/heartbeat/abc.tmp"]);
  });

  it("tracks exact initiation, termination, duration, per-action timeout, and cancellation in runHeartbeatSweep", async () => {
    let clockMs = Date.parse("2026-11-27T12:00:00.000Z");
    const defA: HeartbeatActionDefinition = { ...HEARTBEAT_ACTIONS[0]!, timeoutMs: 500 };
    const defB: HeartbeatActionDefinition = { ...HEARTBEAT_ACTIONS[1]!, timeoutMs: 25 };

    const progress = vi.fn();
    const run = await runHeartbeatSweep({
      id: randomUUID(),
      sequence: 1,
      trigger: "manual",
      mode: "maintain",
      policy: DEFAULT_HEARTBEAT_POLICY,
      now: () => new Date(clockMs),
      signal: new AbortController().signal,
      onProgress: progress,
      runners: [
        {
          definition: defA,
          async execute() {
            clockMs += 150;
            return { status: "remediated", summary: "Fixed 1 item", remediatedCount: 1 };
          },
        },
        {
          definition: defB,
          async execute(signal) {
            return new Promise((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            });
          },
        },
      ],
    });

    expect(run.startedAt).toBe("2026-11-27T12:00:00.000Z");
    expect(run.endedAt).not.toBeNull();
    expect(run.durationMs).toBeGreaterThanOrEqual(150);
    expect(run.status).toBe("failed");
    expect(run.actions[0]?.status).toBe("remediated");
    expect(run.actions[0]?.durationMs).toBe(150);
    expect(run.actions[1]?.status).toBe("failed");
    expect(run.actions[1]?.findings[0]?.code).toBe("action_timeout");
    expect(progress).toHaveBeenCalled();
  });

  it("ignores real symlink temp entries safely on disk", async () => {
    const dir = await makeTempDir("code60-hb-disk-");
    await writeFile(join(dir, "keep.json"), "{}");
    const res = await cleanStaleTempArtifacts(dir, [dir], Date.now() + 7_200_000, "inspect");
    expect(res.candidateCount).toBe(0);
  });
});
