import { copyFile, lstat, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { samePath } from "../platform/index.js";
import { GitError, runGit } from "./exec.js";
import { type GitSetupOps, gitSetup } from "./setup.js";
import { type TaskGit, taskGit } from "./tasks.js";

export type { GitReadiness, GitSetupFile, GitSetupOps } from "./setup.js";
export type { TaskEntry, TaskGit } from "./tasks.js";

interface RepoInfo {
  /** Top-level directory of the working tree the command ran in. */
  topLevel: string;
  /** Absolute path of the common Git directory shared by all worktrees. */
  commonDir: string;
}

export interface WorktreeSpec {
  repoDir: string;
  path: string;
  branch: string;
  base: string;
}

export interface GitWorktree {
  path: string;
  branch: string | null;
  createdAt: string | null;
  sizeBytes: number | null;
}

type ChangeStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface ChangedFile {
  path: string;
  status: ChangeStatus;
}

export interface ReviewSnapshotFile {
  path: string;
  oldPath: string;
  status: "added" | "modified" | "deleted" | "renamed";
  fingerprint: string;
  original: string;
  modified: string;
  limitation?: string;
}
interface ReviewSnapshot {
  files: ReviewSnapshotFile[];
  truncated: boolean;
}

export interface Git {
  setup?: GitSetupOps;
  tasks?: TaskGit;
  repoInfo(cwd: string): Promise<RepoInfo>;
  listWorktrees(repoDir: string): Promise<GitWorktree[]>;
  /** Resolves a revision to a full commit hash. */
  resolveCommit(repoDir: string, rev: string): Promise<string>;
  addWorktree(spec: WorktreeSpec): Promise<void>;
  /** Removes the worktree, then deletes its branch. */
  removeWorktree(repoDir: string, path: string, branch: string): Promise<void>;
  /** Diff of the worktree against `base`, including untracked files and agent commits. */
  diff(worktree: string, base: string, signal?: AbortSignal): Promise<string>;
  reviewSnapshot?(
    worktree: string,
    base: string,
    signal?: AbortSignal,
    captured?: string,
  ): Promise<ReviewSnapshot>;
  changedFiles(worktree: string, base: string): Promise<ChangedFile[]>;
}

const BRANCH_RE = /^code60\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertOwnBranch(branch: string): void {
  if (!BRANCH_RE.test(branch)) throw new Error(`refusing to touch branch '${branch}'`);
}

export function parseWorktrees(output: string): { path: string; branch: string | null }[] {
  const worktrees: { path: string; branch: string | null }[] = [];
  let current: { path: string; branch: string | null; bare: boolean } | undefined;
  const save = () => {
    if (current && !current.bare) worktrees.push({ path: current.path, branch: current.branch });
  };
  for (const field of output.split("\0")) {
    if (field.startsWith("worktree ")) {
      save();
      current = { path: field.slice("worktree ".length), branch: null, bare: false };
    } else if (current && field.startsWith("branch refs/heads/")) {
      current.branch = field.slice("branch refs/heads/".length);
    } else if (current && field === "bare") {
      current.bare = true;
    }
  }
  save();
  return worktrees;
}

async function logicalSize(root: string): Promise<number> {
  const pending = [root];
  let bytes = 0;
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (directory === root && entry.name === ".git") continue;
      const path = join(directory, entry.name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) pending.push(path);
      else if (info.isFile()) bytes += info.size;
    }
  }
  return bytes;
}

async function summarizeWorktree(worktree: {
  path: string;
  branch: string | null;
}): Promise<GitWorktree | undefined> {
  let root: Awaited<ReturnType<typeof lstat>>;
  try {
    root = await lstat(worktree.path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    return { ...worktree, createdAt: null, sizeBytes: null };
  }
  if (!root.isDirectory()) return undefined;
  const createdAt =
    Number.isFinite(root.birthtimeMs) && root.birthtimeMs > 0
      ? new Date(root.birthtimeMs).toISOString()
      : null;
  let sizeBytes: number | null = null;
  try {
    sizeBytes = await logicalSize(worktree.path);
  } catch {
    // An unreadable file or directory makes the total unknown, not a misleading partial size.
  }
  return { ...worktree, createdAt, sizeBytes };
}

/**
 * Runs `op` with a temporary index that mirrors the worktree's files, so diffs
 * include untracked files without changing the worktree's own index.
 */
async function withSnapshotIndex<T>(
  worktree: string,
  op: (env: Record<string, string>) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const dir = await mkdtemp(join(tmpdir(), "code60-index-"));
  try {
    const index = join(dir, "index");
    const own = (
      await runGit(["rev-parse", "--path-format=absolute", "--git-path", "index"], worktree, {
        signal,
      })
    ).trim();
    const env = { GIT_INDEX_FILE: index };
    try {
      // Starting from a copy keeps the stat cache, so `add -A` only rehashes changed files.
      await copyFile(own, index);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await runGit(["read-tree", "HEAD"], worktree, { env, signal });
    }
    signal?.throwIfAborted();
    await runGit(["add", "-A", "--", "."], worktree, { env, signal });
    signal?.throwIfAborted();
    return await op(env);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function statusFromLetter(letter: string): ChangeStatus {
  switch (letter[0]) {
    case "A":
    case "C":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      return "modified";
  }
}

export function parseNameStatus(output: string, untracked: ReadonlySet<string>): ChangedFile[] {
  const fields = output.split("\0");
  const files: ChangedFile[] = [];
  for (let i = 0; i < fields.length; ) {
    const letter = fields[i++];
    if (letter === undefined || letter === "") continue;
    if (letter[0] === "R" || letter[0] === "C") {
      i++; // source path
    }
    const path = fields[i++];
    if (path === undefined) break;
    let status = statusFromLetter(letter);
    if (status === "added" && untracked.has(path)) status = "untracked";
    files.push({ path, status });
  }
  return files;
}

export function createGit(): Git {
  return {
    setup: gitSetup,
    tasks: taskGit,
    async reviewSnapshot(worktree, base, signal, captured) {
      const read = async (env: Record<string, string>) => {
        const tree = captured ?? (await runGit(["write-tree"], worktree, { env, signal })).trim();
        const raw = await runGit(
          ["diff", "--raw", "--no-abbrev", "-z", "-M", base, tree, "--"],
          worktree,
          { env, signal },
        );
        const fields = raw.split("\0");
        const files: ReviewSnapshotFile[] = [];
        let bytes = 0;
        let truncated = false;
        for (let index = 0; index < fields.length && fields[index]; ) {
          signal?.throwIfAborted();
          const header = fields[index++]?.match(
            /^:(\d+) (\d+) ([a-f0-9]+) ([a-f0-9]+) ([A-Z])\d*$/,
          );
          if (!header) throw new Error("Invalid Git review file listing");
          const [, beforeMode, afterMode, before, after, letter] = header;
          const oldPath = fields[index++];
          const path = letter === "R" || letter === "C" ? fields[index++] : oldPath;
          if (!path || !oldPath || !before || !after) throw new Error("Invalid Git review path");
          if (files.length >= 1_000) {
            truncated = true;
            continue;
          }
          let limitation: string | undefined;
          const content = async (oid: string, mode: string | undefined) => {
            if (/^0+$/.test(oid)) return "";
            if (mode !== "100644" && mode !== "100755") {
              limitation =
                mode === "120000" ? "Symbolic link" : "Submodule or unsupported file type";
              return "";
            }
            const size = Number(
              (await runGit(["cat-file", "-s", oid], worktree, { signal })).trim(),
            );
            if (!Number.isFinite(size) || size > 1_048_576 || bytes + size > 8_388_608) {
              limitation =
                size > 1_048_576 ? "File exceeds 1 MiB" : "Revision content limit reached";
              return "";
            }
            bytes += size;
            const text = await runGit(["cat-file", "blob", oid], worktree, { signal });
            if (text.includes("\0") || text.includes("\ufffd")) {
              limitation = "Binary or non-UTF-8 file";
              return "";
            }
            return text;
          };
          const original = await content(before, beforeMode);
          const modified = await content(after, afterMode);
          files.push({
            path,
            oldPath,
            status:
              letter === "R"
                ? "renamed"
                : letter === "A"
                  ? "added"
                  : letter === "D"
                    ? "deleted"
                    : "modified",
            fingerprint: `${beforeMode}:${before}:${afterMode}:${after}`,
            original: limitation ? "" : original,
            modified: limitation ? "" : modified,
            ...(limitation ? { limitation } : {}),
          });
        }
        return { files, truncated };
      };
      return captured ? read({}) : withSnapshotIndex(worktree, read, signal);
    },
    async repoInfo(cwd) {
      let out: string;
      try {
        out = await runGit(
          ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"],
          cwd,
        );
      } catch (error) {
        if (error instanceof GitError) throw new Error("not inside a Git working tree");
        throw error;
      }
      const [topLevel, commonDir] = out.trim().split("\n");
      if (topLevel === undefined || commonDir === undefined) {
        throw new Error("could not determine the Git repository");
      }
      return { topLevel: normalize(topLevel), commonDir: normalize(commonDir) };
    },

    async listWorktrees(repoDir) {
      const output = await runGit(["worktree", "list", "--porcelain", "-z"], repoDir);
      const worktrees = parseWorktrees(output).map((item) => ({
        ...item,
        path: normalize(item.path),
      }));
      const summaries = await Promise.all(worktrees.map(summarizeWorktree));
      return summaries.filter((worktree): worktree is GitWorktree => worktree !== undefined);
    },

    async resolveCommit(repoDir, rev) {
      if (rev === "" || rev.startsWith("-")) throw new Error(`invalid revision '${rev}'`);
      try {
        const out = await runGit(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], repoDir);
        return out.trim();
      } catch {
        throw new Error(`unknown revision '${rev}'`);
      }
    },

    async addWorktree({ repoDir, path, branch, base }) {
      assertOwnBranch(branch);
      await runGit(["worktree", "add", "--quiet", "-b", branch, path, base], repoDir);
    },

    async removeWorktree(repoDir, path, branch) {
      assertOwnBranch(branch);
      const list = await runGit(["worktree", "list", "--porcelain", "-z"], repoDir);
      const inventory = parseWorktrees(list);
      let registered: (typeof inventory)[number] | undefined;
      for (const worktree of inventory) {
        if (await samePath(worktree.path, path)) {
          registered = worktree;
          break;
        }
      }
      if (registered) {
        if (registered.branch !== branch)
          throw new Error("refusing to remove a worktree whose branch does not match the run");
        // A removal failure must never fall through to branch deletion.
        await runGit(["worktree", "remove", "--force", registered.path], repoDir);
      }
      for (const worktree of parseWorktrees(
        await runGit(["worktree", "list", "--porcelain", "-z"], repoDir),
      )) {
        if (worktree.branch === branch)
          throw new Error("refusing to delete a branch still registered to a worktree");
      }
      try {
        await runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repoDir);
      } catch {
        return;
      }
      await runGit(["branch", "-D", branch], repoDir);
    },

    async diff(worktree, base, signal) {
      return withSnapshotIndex(
        worktree,
        (env) =>
          runGit(["diff", "--cached", "--no-color", "--no-ext-diff", base, "--"], worktree, {
            env,
            timeoutMs: 120_000,
            signal,
          }),
        signal,
      );
    },

    async changedFiles(worktree, base) {
      const untrackedOut = await runGit(
        ["ls-files", "-z", "--others", "--exclude-standard"],
        worktree,
      );
      const untracked = new Set(untrackedOut.split("\0").filter((p) => p !== ""));
      const out = await withSnapshotIndex(worktree, (env) =>
        runGit(["diff", "--cached", "--name-status", "-z", "-M", base, "--"], worktree, { env }),
      );
      return parseNameStatus(out, untracked);
    },
  };
}
