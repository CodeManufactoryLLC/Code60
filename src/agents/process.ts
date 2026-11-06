import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";

export const STDERR_TAIL_BYTES = 64 * 1024;
export const KILL_GRACE_MS = 5_000;
const POLL_MS = 25;

export interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface AgentProcess {
  readonly pid: number;
  readonly input: WritableStream<Uint8Array>;
  readonly output: ReadableStream<Uint8Array>;
  readonly exited: Promise<ExitInfo>;
  hasExited(): boolean;
  stderrTail(): string;
  /** SIGTERM to the process group, then SIGKILL once `graceMs` passes. A later call can shorten the grace. */
  stop(graceMs?: number): Promise<void>;
}

/** Keeps only the last `limit` bytes written to it. */
export class TailBuffer {
  private chunks: Buffer[] = [];
  private size = 0;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.limit && this.chunks.length > 0) {
      const first = this.chunks[0] as Buffer;
      const excess = this.size - this.limit;
      if (first.length <= excess) {
        this.chunks.shift();
        this.size -= first.length;
      } else {
        this.chunks[0] = first.subarray(excess);
        this.size -= excess;
      }
    }
  }

  toString(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

function signalGroup(pgid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    return false;
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function describeExit({ code, signal }: ExitInfo): string {
  return signal !== null ? `agent exited on signal ${signal}` : `agent exited with code ${code}`;
}

/** Spawns the agent in its own process group, with the worktree as its working directory. */
export async function spawnAgent(
  command: readonly [string, ...string[]],
  cwd: string,
  env?: Readonly<Record<string, string>>,
): Promise<AgentProcess> {
  const [file, ...args] = command;
  const child = spawn(file, args, {
    cwd,
    env: env ?? process.env,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", (error) => {
      reject(new Error(`could not start '${file}': ${error.message}`));
    });
  });
  const pid = child.pid as number;

  const tail = new TailBuffer(STDERR_TAIL_BYTES);
  child.stderr.on("data", (chunk: Buffer) => tail.push(chunk));
  // Writes after the agent exits fail with EPIPE; the exit itself is reported separately.
  child.stdin.on("error", () => {});
  child.on("error", () => {});

  let exitInfo: ExitInfo | undefined;
  const exited = new Promise<ExitInfo>((resolve) => {
    child.once("exit", (code, signal) => {
      exitInfo = { code, signal };
      resolve(exitInfo);
    });
  });

  let deadline = Number.POSITIVE_INFINITY;
  let stopping: Promise<void> | undefined;

  const stop = (graceMs = KILL_GRACE_MS): Promise<void> => {
    deadline = Math.min(deadline, Date.now() + graceMs);
    stopping ??= (async () => {
      signalGroup(pid, "SIGTERM");
      while (signalGroup(pid, 0) && Date.now() < deadline) await sleep(POLL_MS);
      signalGroup(pid, "SIGKILL");
      await exited;
      while (signalGroup(pid, 0)) await sleep(POLL_MS);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    })();
    return stopping;
  };

  return {
    pid,
    input: Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    output: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    exited,
    hasExited: () => exitInfo !== undefined,
    stderrTail: () => tail.toString(),
    stop,
  };
}
