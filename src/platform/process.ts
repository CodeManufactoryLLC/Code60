import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { resolveCommand } from "./command.js";

interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface OwnedProcess {
  pid: number;
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  exited: Promise<ProcessExit>;
  hasExited(): boolean;
  stop(graceMs?: number): Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const EXIT_DEADLINE_MS = 7_000;

function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function boundedExit(exited: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Owned process cleanup exceeded seven seconds")),
          EXIT_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function streams(child: ChildProcessWithoutNullStreams) {
  child.stdin.on("error", () => {}); // ACP reports transport failure separately.
  child.on("error", () => {});
  return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr };
}

async function posixProcess(
  file: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<OwnedProcess> {
  const child = spawn(file, args, {
    cwd,
    env,
    detached: true,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let info: ProcessExit | undefined;
  const exited = new Promise<ProcessExit>((resolve) => {
    child.once("exit", (code, signal) => {
      info = { code, signal };
      resolve(info);
    });
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", (error) =>
      reject(new Error(`could not start '${file}': ${error.message}`, { cause: error })),
    );
  });
  const pid = child.pid as number;
  let deadline = Number.POSITIVE_INFINITY;
  let stopping: Promise<void> | undefined;
  let terminationSent = false;
  return {
    pid,
    ...streams(child),
    exited,
    hasExited: () => info !== undefined,
    stop(graceMs = 5_000) {
      deadline = Math.min(deadline, Date.now() + Math.max(0, graceMs));
      stopping ??= (async () => {
        if (!terminationSent) {
          signalGroup(pid, "SIGTERM");
          while (signalGroup(pid, 0) && Date.now() < deadline) await sleep(25);
          signalGroup(pid, "SIGKILL");
          terminationSent = true;
        }
        await boundedExit(exited);
        const verifyUntil = Date.now() + EXIT_DEADLINE_MS;
        while (signalGroup(pid, 0)) {
          if (Date.now() >= verifyUntil)
            throw new Error("Process group cleanup exceeded seven seconds");
          await sleep(25);
        }
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
      })();
      void stopping.catch(() => {
        stopping = undefined;
      });
      return stopping;
    },
  };
}

export async function spawnOwnedProcess(
  command: readonly [string, ...string[]],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OwnedProcess> {
  const resolved = await resolveCommand(command, env);
  return posixProcess(resolved.file, resolved.args, cwd, env);
}
