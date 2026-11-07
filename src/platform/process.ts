import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import type { Readable, Writable } from "node:stream";
import { resolveCommand } from "./command.js";
import {
  type NativeProcessIdentity,
  ownedJob,
  parseNativeIdentity,
  windowsHelper,
} from "./helper.js";

export interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface OwnedProcess {
  pid: number;
  /** Exact supervisor child, exposed only inside the Node-only process layer. */
  supervisorPid?: number;
  identity?: NativeProcessIdentity;
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
      reject(new Error(`could not start '${file}': ${error.message}`)),
    );
  });
  const pid = child.pid as number;
  let deadline = Number.POSITIVE_INFINITY;
  let stopping: Promise<void> | undefined;
  return {
    pid,
    ...streams(child),
    exited,
    hasExited: () => info !== undefined,
    stop(graceMs = 5_000) {
      deadline = Math.min(deadline, Date.now() + Math.max(0, graceMs));
      stopping ??= (async () => {
        signalGroup(pid, "SIGTERM");
        while (signalGroup(pid, 0) && Date.now() < deadline) await sleep(25);
        signalGroup(pid, "SIGKILL");
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
      return stopping;
    },
  };
}

async function windowsProcess(
  file: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<OwnedProcess> {
  const helper = windowsHelper();
  const id = randomUUID();
  const pipe = `\\\\.\\pipe\\code60-${id}`;
  const token = randomBytes(32).toString("hex");
  const server = createServer();
  const sockets = new Set<Socket>();
  let control: Socket | undefined;
  let child: ChildProcessWithoutNullStreams | undefined;
  let helperExited: Promise<void> | undefined;
  let info: ProcessExit | undefined;
  let exitResolve!: (info: ProcessExit) => void;
  const exited = new Promise<ProcessExit>((resolve) => {
    exitResolve = resolve;
  });
  let readyResolve!: (value: { pid: number; identity: NativeProcessIdentity }) => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<{ pid: number; identity: NativeProcessIdentity }>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  // Register rejection immediately, including listen and synchronous spawn failures.
  ready.catch(() => {});
  const finish = (value: ProcessExit) => {
    info ??= value;
    exitResolve(info);
  };
  server.on("connection", (socket) => {
    sockets.add(socket);
    let pending = "";
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      if (pending.length > 8 * 1024) {
        socket.destroy();
        return;
      }
      for (;;) {
        const end = pending.indexOf("\n");
        if (end < 0) break;
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        try {
          const value = JSON.parse(line) as Record<string, unknown>;
          if (!control) {
            if (
              value.version !== 1 ||
              value.token !== token ||
              typeof value.pid !== "number" ||
              !Number.isSafeInteger(value.pid) ||
              value.pid <= 0 ||
              value.job !== `Local\\Code60-${id}`
            )
              throw new Error("Invalid helper handshake");
            const identity = parseNativeIdentity(value);
            control = socket;
            server.close();
            for (const other of sockets) if (other !== socket) other.destroy();
            readyResolve({ pid: value.pid, identity });
          } else if (
            socket === control &&
            value.stopped === true &&
            typeof value.exit === "number" &&
            Number.isSafeInteger(value.exit)
          ) {
            finish({ code: value.exit, signal: null });
          } else throw new Error("Invalid helper response");
        } catch {
          socket.destroy();
        }
      }
    });
  });
  const startup = setTimeout(
    () => readyReject(new Error("Windows helper startup exceeded five seconds")),
    5_000,
  );
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(pipe, resolve);
      }),
      ready.then(() => undefined),
    ]);
    child = spawn(
      helper,
      ["run", pipe, `Local\\Code60-${id}`, String(process.pid), file, ...args],
      {
        cwd,
        env: { ...env, CODE60_HOST_CONTROL_TOKEN: token },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const io = streams(child);
    helperExited = new Promise<void>((resolve) => {
      child?.once("exit", (code, signal) => {
        readyReject(
          new Error(`could not start '${file}': Windows helper exited (${code ?? signal})`),
        );
        // The separate control pipe can still have its final exit frame queued.
        setTimeout(() => {
          finish({ code: code === 0 ? null : code, signal });
          for (const socket of sockets) socket.destroy();
          server.close();
          resolve();
        }, 25);
      });
      child?.once("error", (error) => {
        readyReject(new Error(`could not start '${file}': ${error.message}`));
        finish({ code: null, signal: null });
        resolve();
      });
    });
    const launched = await ready;
    let stopping: Promise<void> | undefined;
    return {
      ...launched,
      supervisorPid: child.pid as number,
      ...io,
      exited,
      hasExited: () => info !== undefined,
      stop() {
        // ACP cancellation and its ten-second wait happen above this layer.
        // Windows has no SIGTERM grace: terminate the owned job, not a guessed PID tree.
        stopping ??= (async () => {
          const deadline = Date.now() + EXIT_DEADLINE_MS;
          if (control && !control.destroyed) control.end("stop\n");
          await boundedExit(helperExited as Promise<void>);
          const remaining = deadline - Date.now();
          if (
            remaining <= 0 ||
            (await ownedJob("status", launched.pid, launched.identity, remaining)) !== "gone"
          )
            throw new Error("Windows helper did not verify owned job exit");
          io.stdin.destroy();
          io.stdout.destroy();
          io.stderr.destroy();
        })();
        return stopping;
      },
    };
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    server.close();
    // This exact child is our helper. Killing it closes its kill-on-close job.
    child?.kill();
    if (helperExited) await boundedExit(helperExited);
    throw error;
  } finally {
    clearTimeout(startup);
  }
}

export async function spawnOwnedProcess(
  command: readonly [string, ...string[]],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OwnedProcess> {
  const resolved = await resolveCommand(command, env);
  return process.platform === "win32"
    ? windowsProcess(resolved.file, resolved.args, cwd, env)
    : posixProcess(resolved.file, resolved.args, cwd, env);
}
