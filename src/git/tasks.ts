import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { GitError, runGit } from "./exec.js";
import { taskFileExclusion } from "./task-files.js";

export interface TaskEntry {
  oid: string;
  mode: string;
}
interface TaskSnapshotOptions {
  exclude?: string[];
}
export interface TaskGit {
  snapshot(directory: string, options?: TaskSnapshotOptions, signal?: AbortSignal): Promise<string>;
  tree(directory: string, commit: string): Promise<Record<string, TaskEntry>>;
  blob(directory: string, oid: string, path?: string): Promise<Buffer>;
  merge(base: Buffer, current: Buffer, proposed: Buffer): Promise<Buffer | null>;
  identity(directory: string): Promise<string>;
  lockPath(directory: string): Promise<string>;
}
const objectId = (value: string) => {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value))
    throw new Error("Invalid task object identity");
  return value;
};

export const taskGit: TaskGit = {
  async snapshot(directory, options = {}, signal) {
    const unlocked = async () => {
      try {
        await readFile(await this.lockPath(directory));
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
        throw cause;
      }
      throw new Error("Finish or recover the current task operation before capturing files.");
    };
    await unlocked();
    const root = (await runGit(["rev-parse", "--show-toplevel"], directory, { signal })).trim();
    if (resolve(root) !== resolve(directory))
      throw new Error("Open the repository root to start a task from current files.");
    const temp = await mkdtemp(join(tmpdir(), "code60-task-index-"));
    try {
      const identity = await this.identity(directory);
      const parent = identity.split(":", 1)[0] as string;
      const index = join(temp, "index");
      const own = (
        await runGit(["rev-parse", "--path-format=absolute", "--git-path", "index"], directory, {
          signal,
        })
      ).trim();
      try {
        await copyFile(own, index);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await runGit(["read-tree", "HEAD"], directory, { env: { GIT_INDEX_FILE: index }, signal });
      }
      const seed = (
        await runGit(["write-tree"], directory, {
          env: { GIT_INDEX_FILE: index },
          signal,
        })
      ).trim();
      const tracked = (await runGit(["ls-files", "--cached", "-t", "-z"], directory, { signal }))
        .split("\0")
        .filter(Boolean)
        .map((entry) => ({ path: entry.slice(2), sparse: entry.startsWith("S ") }));
      const untracked = (
        await runGit(["ls-files", "--others", "--exclude-standard", "-z"], directory, { signal })
      )
        .split("\0")
        .filter(Boolean);
      const excluded = (path: string) =>
        path.toLowerCase().split("/").includes(".code60_workspace") ||
        options.exclude?.some((value) => resolve(directory, path) === resolve(value));
      const paths = [
        ...tracked.filter((entry) => !entry.sparse).map((entry) => entry.path),
        ...untracked.filter((path) => !taskFileExclusion(path)),
      ].filter((path) => !excluded(path));
      const pathspec = join(temp, "paths");
      await writeFile(pathspec, paths.join("\0") + (paths.length ? "\0" : ""));
      const capture = async (name: string) => {
        // Read the staged tree into a fresh index so Git hashes saved file contents
        // even when a same-length write lands within the original index's stat window.
        const env = { GIT_INDEX_FILE: join(temp, name) };
        await runGit(["read-tree", seed], directory, { env, signal });
        if (paths.length)
          await runGit(
            [
              "--literal-pathspecs",
              "add",
              "-A",
              `--pathspec-from-file=${pathspec}`,
              "--pathspec-file-nul",
            ],
            directory,
            { env, signal },
          );
        for (const { path } of tracked)
          if (excluded(path))
            await runGit(["update-index", "--force-remove", "--", path], directory, {
              env,
              signal,
            });
        return (await runGit(["write-tree"], directory, { env, signal })).trim();
      };
      const tree = await capture("capture");
      if (tree !== (await capture("verify")) || identity !== (await this.identity(directory)))
        throw new Error("Project files changed while capturing the task. Try again.");
      await unlocked();
      const latest = (
        await runGit(["ls-files", "--others", "--exclude-standard", "-z"], directory, { signal })
      )
        .split("\0")
        .filter(Boolean);
      if (
        latest.some(
          (path) => !untracked.includes(path) && !excluded(path) && !taskFileExclusion(path),
        )
      )
        throw new Error("Project files changed while capturing the task. Try again.");
      const commit = (
        await runGit(
          [
            "-c",
            "commit.gpgsign=false",
            "commit-tree",
            tree,
            "-p",
            parent,
            "-m",
            "Code60 private task snapshot",
          ],
          directory,
          {
            signal,
            env: {
              GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
              GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
              GIT_AUTHOR_NAME: "Code60",
              GIT_AUTHOR_EMAIL: "snapshot@code60.invalid",
              GIT_COMMITTER_NAME: "Code60",
              GIT_COMMITTER_EMAIL: "snapshot@code60.invalid",
            },
          },
        )
      ).trim();
      await runGit(["update-ref", `refs/code60/tasks/${commit}`, commit], directory, {
        signal,
      });
      return commit;
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  },
  async tree(directory, commit) {
    const out = await runGit(["ls-tree", "-rz", "--full-tree", objectId(commit)], directory);
    const entries: Record<string, TaskEntry> = Object.create(null);
    for (const entry of out.split("\0").filter(Boolean)) {
      const match = /^(\d+) \w+ ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
      if (!match) throw new Error("Invalid task tree");
      entries[match[3] as string] = { mode: match[1] as string, oid: objectId(match[2] as string) };
    }
    return entries;
  },
  async blob(directory, oid, path) {
    objectId(oid);
    const size = Number((await runGit(["cat-file", "-s", oid], directory)).trim());
    if (!Number.isSafeInteger(size) || size > 32 * 1024 * 1024)
      throw new Error("Task file exceeds the 32 MiB application limit");
    return new Promise((resolve, reject) => {
      execFile(
        "git",
        path ? ["cat-file", "--filters", `--path=${path}`, oid] : ["cat-file", "blob", oid],
        {
          cwd: directory,
          encoding: "buffer",
          timeout: 60_000,
          maxBuffer: 33 * 1024 * 1024,
          windowsHide: true,
        },
        (error, stdout) =>
          error || stdout.length > 32 * 1024 * 1024
            ? reject(new Error("Could not read task file within the 32 MiB limit"))
            : resolve(stdout),
      );
    });
  },
  async merge(base, current, proposed) {
    if (
      [base, current, proposed].some(
        (data) => data.includes(0) || !Buffer.from(data.toString("utf8")).equals(data),
      )
    )
      return null;
    const temp = await mkdtemp(join(tmpdir(), "code60-task-merge-"));
    try {
      await Promise.all([
        writeFile(join(temp, "base"), base),
        writeFile(join(temp, "current"), current),
        writeFile(join(temp, "proposed"), proposed),
      ]);
      try {
        await runGit(["merge-file", "--", "current", "base", "proposed"], temp);
      } catch (cause) {
        if (
          cause instanceof GitError &&
          cause.exitCode !== null &&
          cause.exitCode > 0 &&
          cause.exitCode < 128
        )
          return null;
        throw cause;
      }
      return await readFile(join(temp, "current"));
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  },
  async identity(directory) {
    const head = (await runGit(["rev-parse", "HEAD"], directory)).trim();
    const branch = await runGit(["rev-parse", "--symbolic-full-name", "HEAD"], directory);
    const staged = await runGit(["ls-files", "--stage", "-z"], directory);
    return `${head}:${branch.trim()}:${createHash("sha256").update(staged).digest("hex")}`;
  },
  async lockPath(directory) {
    return (
      await runGit(
        ["rev-parse", "--path-format=absolute", "--git-path", "code60-task-apply.lock"],
        directory,
      )
    ).trim();
  },
};
