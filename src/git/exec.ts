import { execFile } from "node:child_process";

export const DEFAULT_GIT_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 256 * 1024 * 1024;

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export interface GitExecOptions {
  timeoutMs?: number;
  env?: Readonly<Record<string, string>>;
}

/** Runs `git` with an argument array (never a shell) and returns standard output. */
export function runGit(
  args: readonly string[],
  cwd: string,
  options: GitExecOptions = {},
): Promise<string> {
  const env = { ...process.env, ...options.env };
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      {
        cwd,
        env,
        timeout: options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        encoding: "utf8",
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(stdout);
          return;
        }
        const code = typeof error.code === "number" ? error.code : null;
        const detail = stderr.trim() || error.message;
        const what = error.killed ? "timed out" : "failed";
        reject(new GitError(`git ${args[0] ?? ""} ${what}: ${detail}`, args, stderr, code));
      },
    );
  });
}
