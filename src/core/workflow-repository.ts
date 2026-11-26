import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/** Clear caller Git env vars so nested worktree or hook invocations cannot redirect snapshots. */
function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    "GIT_DIR",
    "GIT_COMMON_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_PREFIX",
  ]) {
    delete env[key];
  }
  return env;
}

function runGit(root: string, args: readonly string[], env = gitEnvironment()): string {
  return execFileSync(
    "git",
    ["-C", root, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
    {
      env,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trimEnd();
}

export function resolveWorkflowRepository(path: string): string {
  if (!isAbsolute(path)) {
    throw new Error("Supply the absolute path of the existing project.");
  }
  return realpathSync(runGit(path, ["rev-parse", "--show-toplevel"]));
}

function privateObjectEnv(root: string, dir: string): NodeJS.ProcessEnv {
  const objects = join(dir, "objects");
  mkdirSync(objects, { recursive: true, mode: 0o700 });
  return {
    ...gitEnvironment(),
    GIT_OBJECT_DIRECTORY: objects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: JSON.stringify(
      runGit(root, ["rev-parse", "--path-format=absolute", "--git-path", "objects"]),
    ),
  };
}

/**
 * Captures the working tree (tracked + non-ignored untracked files) using a disposable index
 * and private Git objects, leaving HEAD, branches, and staging untouched.
 */
export function snapshotWorkflowTree(root: string, dir: string): string {
  const indexFile = join(dir, `${randomUUID()}.index`);
  const env = { ...privateObjectEnv(root, dir), GIT_INDEX_FILE: indexFile };
  const currentIndex = runGit(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"]);
  try {
    if (existsSync(currentIndex)) copyFileSync(currentIndex, indexFile);
    runGit(root, ["add", "-A", "--", "."], env);
    return runGit(root, ["write-tree"], env);
  } finally {
    rmSync(indexFile, { force: true });
  }
}

export function writeWorkflowPatch(
  root: string,
  dir: string,
  baseline: string,
  revision: string,
  fd: number,
): void {
  execFileSync(
    "git",
    ["-C", root, "diff", "--no-ext-diff", "--no-textconv", "--binary", baseline, revision],
    {
      env: privateObjectEnv(root, dir),
      stdio: ["ignore", fd, "pipe"],
      timeout: 120_000,
    },
  );
}
