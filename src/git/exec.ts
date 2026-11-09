import { execFile } from "node:child_process";
import { spawnOwnedProcess } from "../platform/index.js";

const DEFAULT_GIT_TIMEOUT_MS = 60_000;
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
  signal?: AbortSignal | undefined;
  env?: Readonly<Record<string, string>>;
}

/** Runs `git` with an argument array (never a shell) and returns standard output. */
export function runGit(
  args: readonly string[],
  cwd: string,
  options: GitExecOptions = {},
): Promise<string> {
  const env = { ...process.env, ...options.env };
  const signal = options.signal;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const abort = () => child.kill("SIGKILL");
    // Do not pass execFile a signal: its abort callback can precede process exit.
    // Settle only from the normal completion callback, after Git releases its index.
    const child = execFile(
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
        signal?.removeEventListener("abort", abort);
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
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
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** Setup mutations can invoke hooks/signers: cancel their entire owned process tree. */
export async function runSetupGit(
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const child = await spawnOwnedProcess(["git", ...args], cwd);
  let failure: unknown;
  let stdout = "";
  let stderr = "";
  let bytes = 0;
  let stopping: Promise<void> | undefined;
  const stop = (reason: unknown) => {
    failure ??= reason;
    stopping ??= child.stop(0);
    void stopping.catch(() => {});
  };
  const abort = () => stop(signal?.reason ?? new Error("Git setup cancelled"));
  const timer = setTimeout(() => stop(new Error("Git setup timed out")), DEFAULT_GIT_TIMEOUT_MS);
  const streams = [child.stdout, child.stderr].map(
    (stream, index) =>
      new Promise<void>((resolve) => {
        stream.setEncoding("utf8");
        stream.on("data", (chunk: string) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > MAX_BUFFER) {
            stop(new Error("Git setup output limit exceeded"));
            return;
          }
          if (index === 0) stdout += chunk;
          else stderr += chunk;
        });
        stream.once("end", resolve);
        stream.once("close", resolve);
        stream.once("error", (cause) => {
          stop(cause);
          resolve();
        });
      }),
  );
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  child.stdin.end();
  try {
    const [exit] = await Promise.all([child.exited, ...streams]);
    await stopping;
    if (failure) throw failure;
    if (exit.code !== 0)
      throw new GitError(
        `git ${args[0] ?? ""} failed: ${stderr.trim() || exit.signal || exit.code}`,
        args,
        stderr,
        exit.code,
      );
    return stdout;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    await child.stop(0);
  }
}
