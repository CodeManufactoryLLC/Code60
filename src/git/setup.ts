import { lstat, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { GitError, runGit, runSetupGit } from "./exec.js";
import { coordinateMetadata } from "./metadata.js";

export type GitReadiness = {
  status: "ready" | "not_repository" | "no_commits" | "missing" | "unavailable";
  message: string;
  root?: string;
};
export interface GitSetupFile {
  path: string;
  fingerprint: string;
  size: number;
}
interface GitSetupPreview {
  readiness: GitReadiness;
  files: GitSetupFile[];
  author: { name: string; email: string };
  excluded: string[];
}
export interface GitSetupOps {
  readiness(directory: string, signal?: AbortSignal): Promise<GitReadiness>;
  preview(
    directory: string,
    signal?: AbortSignal,
    excludedPaths?: string[],
  ): Promise<GitSetupPreview>;
  initialize(directory: string, signal?: AbortSignal): Promise<void>;
  commit(
    directory: string,
    files: GitSetupFile[],
    author: { name: string; email: string },
    signal?: AbortSignal,
  ): Promise<void>;
}
const detail = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Probe without treating permissions, broken metadata or a missing executable as an empty repo. */
async function readiness(directory: string, signal?: AbortSignal): Promise<GitReadiness> {
  signal?.throwIfAborted();
  try {
    if (!(await stat(directory)).isDirectory()) throw new Error("The project is not a directory.");
  } catch (cause) {
    signal?.throwIfAborted();
    return { status: "unavailable", message: detail(cause) };
  }
  try {
    await runGit(["--version"], directory, { signal });
  } catch (cause) {
    signal?.throwIfAborted();
    return {
      status:
        cause instanceof GitError && cause.message.includes("ENOENT") ? "missing" : "unavailable",
      message: detail(cause),
    };
  }
  let marker: string | undefined;
  try {
    for (let candidate = resolve(directory); ; ) {
      try {
        await lstat(join(candidate, ".git"));
        marker = candidate;
        break;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      }
      const parent = dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
    if (
      (await runGit(["rev-parse", "--is-bare-repository"], directory, { signal })).trim() === "true"
    )
      return {
        status: "unavailable",
        message: "Open a working directory, not a bare Git repository.",
      };
    const root = (await runGit(["rev-parse", "--show-toplevel"], directory, { signal })).trim();
    try {
      await runGit(["rev-parse", "--verify", "HEAD^{commit}"], directory, { signal });
      return { status: "ready", root, message: "Ready for isolated workers" };
    } catch (cause) {
      signal?.throwIfAborted();
      const branch = (await runGit(["symbolic-ref", "-q", "HEAD"], directory, { signal })).trim();
      try {
        await runGit(["show-ref", "--verify", "--quiet", branch], directory, { signal });
      } catch (missing) {
        if (missing instanceof GitError && missing.exitCode === 1)
          return {
            status: "no_commits",
            root,
            message: "This repository needs an initial commit.",
          };
        throw missing;
      }
      throw cause;
    }
  } catch (cause) {
    signal?.throwIfAborted();
    if (!marker && cause instanceof GitError && cause.exitCode === 128)
      return { status: "not_repository", message: "This folder is not a Git repository." };
    return { status: "unavailable", message: detail(cause) };
  }
}

async function fingerprint(
  directory: string,
  path: string,
  signal?: AbortSignal,
): Promise<GitSetupFile> {
  const target = resolve(directory, path);
  if (relative(directory, target).startsWith("..") || !path || path.includes("\0"))
    throw new Error("Invalid setup file");
  for (let cursor = target; cursor !== resolve(directory); cursor = dirname(cursor)) {
    if ((await lstat(cursor)).isSymbolicLink())
      throw new Error("Symbolic links are not included in Git setup");
  }
  const info = await lstat(target);
  if (!info.isFile()) throw new Error("Only regular files can be included in Git setup");
  if (info.size > 32 * 1024 * 1024) throw new Error("File exceeds the 32 MiB setup limit");
  const hash = (
    await runGit(["hash-object", "--no-filters", "--", path], directory, { signal })
  ).trim();
  return { path, size: info.size, fingerprint: `${info.mode}:${info.size}:${hash}` };
}

export const gitSetup: GitSetupOps = {
  readiness,
  async preview(directory, signal, excludedPaths = []) {
    const state = await readiness(directory, signal);
    if (!["not_repository", "no_commits"].includes(state.status)) throw new Error(state.message);
    if (state.root && resolve(state.root) !== resolve(directory))
      throw new Error("Open the repository root to create its initial commit.");
    let temporary: string | undefined;
    try {
      // A private scratch repository lets Git apply its own ignore rules before project initialization.
      let args: string[] = [];
      if (state.status === "not_repository") {
        temporary = await mkdtemp(join(tmpdir(), "code60-git-preview-"));
        await runGit(["init", "--bare", "--quiet", temporary], directory, { signal });
        args = [`--git-dir=${temporary}`, `--work-tree=${directory}`];
      }
      const paths = [
        ...new Set(
          (
            await runGit(
              [...args, "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
              directory,
              { signal },
            )
          )
            .split("\0")
            .filter(
              (path) =>
                path &&
                !path.split("/").includes(".code60_workspace") &&
                !excludedPaths.some((excluded) => resolve(directory, path) === resolve(excluded)),
            ),
        ),
      ];
      if (paths.length > 10_000)
        throw new Error(
          "Too many files for guided setup. Adjust Git ignore rules or create the initial commit in your Git tool.",
        );
      const files: GitSetupFile[] = [];
      const excluded: string[] = [];
      for (const path of paths) {
        signal?.throwIfAborted();
        try {
          files.push(await fingerprint(directory, path, signal));
        } catch (cause) {
          signal?.throwIfAborted();
          excluded.push(`${path}: ${detail(cause)}`);
        }
      }
      const config = async (key: string) => {
        try {
          return (await runGit(["config", "--get", key], directory, { signal })).trim();
        } catch (cause) {
          if (cause instanceof GitError && cause.exitCode === 1) return "";
          throw cause;
        }
      };
      return {
        readiness: state,
        files,
        excluded,
        author: { name: await config("user.name"), email: await config("user.email") },
      };
    } finally {
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  },
  async initialize(directory, signal) {
    const state = await readiness(directory, signal);
    if (state.status === "no_commits") return;
    if (state.status !== "not_repository") throw new Error(state.message);
    await runSetupGit(["init", "--quiet"], directory, signal);
  },
  async commit(directory, files, author, signal) {
    return coordinateMetadata(
      directory,
      async () => {
        const state = await readiness(directory, signal);
        if (state.status !== "no_commits" || resolve(state.root ?? "") !== resolve(directory))
          throw new Error("Initial commit requires this project to be an uncommitted repository.");
        for (const file of files) {
          if ((await fingerprint(directory, file.path, signal)).fingerprint !== file.fingerprint)
            throw new Error("Selected files changed. Refresh the setup preview before committing.");
        }
        const configured = async (key: string, value: string) => {
          let current = "";
          try {
            current = (await runGit(["config", "--get", key], directory, { signal })).trim();
          } catch (cause) {
            if (!(cause instanceof GitError && cause.exitCode === 1)) throw cause;
          }
          if (!current) await runGit(["config", "--local", key, value], directory, { signal });
        };
        await configured("user.name", author.name);
        await configured("user.email", author.email);
        const temporary = await mkdtemp(join(tmpdir(), "code60-git-commit-"));
        try {
          const paths = join(temporary, "paths");
          await writeFile(
            paths,
            files.map((file) => file.path).join("\0") + (files.length ? "\0" : ""),
            { mode: 0o600 },
          );
          if (files.length) {
            const pathspec = [`--pathspec-from-file=${paths}`, "--pathspec-file-nul"];
            await runSetupGit(["--literal-pathspecs", "add", ...pathspec], directory, signal);
            await runSetupGit(
              ["--literal-pathspecs", "commit", "--only", "-m", "Initial commit", ...pathspec],
              directory,
              signal,
            );
          } else {
            const staged = await runGit(["ls-files", "-z"], directory, { signal });
            if (staged)
              throw new Error("Staged files exist. Refresh the setup preview before committing.");
            await runSetupGit(
              ["commit", "--allow-empty", "-m", "Initial commit"],
              directory,
              signal,
            );
          }
        } finally {
          await rm(temporary, { recursive: true, force: true });
        }
      },
      signal,
    );
  },
};
