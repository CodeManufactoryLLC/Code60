import { Readable, Writable } from "node:stream";
import {
  DiagnosticTail,
  type NativeProcessIdentity,
  spawnOwnedProcess,
} from "../platform/index.js";

const STDERR_TAIL_BYTES = 64 * 1024;

export interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface AgentProcess {
  readonly pid: number;
  readonly identity?: NativeProcessIdentity;
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

export function describeExit({ code, signal }: ExitInfo): string {
  return signal !== null ? `agent exited on signal ${signal}` : `agent exited with code ${code}`;
}

/** Spawns the agent in its own process group, with the worktree as its working directory. */
export async function spawnAgent(
  command: readonly [string, ...string[]],
  cwd: string,
  env?: Readonly<Record<string, string>>,
): Promise<AgentProcess> {
  const child = await spawnOwnedProcess(command, cwd, env);
  const tail = new DiagnosticTail(STDERR_TAIL_BYTES);
  child.stderr.on("data", (chunk: Buffer) => tail.push(chunk));
  // Writes after the agent exits fail with EPIPE; the exit itself is reported separately.
  child.stdin.on("error", () => {});
  return {
    pid: child.pid,
    ...(child.identity === undefined ? {} : { identity: child.identity }),
    input: Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    output: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    exited: child.exited,
    hasExited: () => child.hasExited(),
    stderrTail: () => tail.toString(),
    stop: (graceMs) => child.stop(graceMs),
  };
}
