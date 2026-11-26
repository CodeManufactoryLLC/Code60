import { type ChildProcess, spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { userInfo } from "node:os";
import { basename, isAbsolute } from "node:path";
import type { Duplex } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { assertSupportedPlatform } from "./support.js";

interface PtyExit {
  code: number | null;
  signal: string | null;
}

export interface OwnedPty {
  readonly pid: number;
  readonly shell: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(listener: (chunk: string) => void): () => void;
  readonly exited: Promise<PtyExit>;
  hasExited(): boolean;
  stop(graceMs?: number): Promise<void>;
}

export interface SpawnPtyOptions {
  cwd: string;
  cols: number;
  rows: number;
  env?: NodeJS.ProcessEnv;
}

export interface ResolvedShell {
  file: string;
  args: string[];
  name: string;
}

const EXIT_DEADLINE_MS = 7_000;
const STARTUP_DEADLINE_MS = 5_000;
const MIN_COLS = 2;
const MAX_COLS = 500;
const MIN_ROWS = 1;
const MAX_ROWS = 200;

export function clampDimensions(cols: number, rows: number): { cols: number; rows: number } {
  const safeCols = Number.isFinite(cols) ? Math.trunc(cols) : 80;
  const safeRows = Number.isFinite(rows) ? Math.trunc(rows) : 24;
  return {
    cols: Math.max(MIN_COLS, Math.min(MAX_COLS, safeCols)),
    rows: Math.max(MIN_ROWS, Math.min(MAX_ROWS, safeRows)),
  };
}

function executableFile(path: string | undefined | null): path is string {
  if (!path || !isAbsolute(path) || path.includes("\0")) return false;
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function posixPtyHelper(): string {
  assertSupportedPlatform();
  const candidates = [
    fileURLToPath(new URL("./code60-pty", import.meta.url)),
    fileURLToPath(new URL("../../dist/platform/code60-pty", import.meta.url)),
  ];
  const found = candidates.find((candidate) => executableFile(candidate));
  if (!found) {
    throw new Error(
      "POSIX PTY helper binary is missing. Run `npm run build` to compile native/posix/code60-pty.c.",
    );
  }
  return found;
}

export function resolveUserShell(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  options: {
    accountShell?: () => string | null;
    isExecutable?: (path: string) => boolean;
  } = {},
): ResolvedShell {
  const check = options.isExecutable ?? executableFile;
  const login =
    options.accountShell ??
    (() => {
      try {
        return userInfo().shell;
      } catch {
        return null;
      }
    });
  const candidates = [
    env.SHELL,
    login(),
    ...(platform === "darwin" ? ["/bin/zsh", "/bin/bash", "/bin/sh"] : ["/bin/bash", "/bin/sh"]),
  ];
  const shell = candidates.find((entry): entry is string =>
    Boolean(entry && isAbsolute(entry) && !entry.includes("\0") && check(entry)),
  );
  if (!shell) throw new Error("No executable shell found");
  const name = basename(shell);
  const args = platform === "darwin" && (name === "zsh" || name === "bash") ? ["-l"] : [];
  return { file: shell, args, name };
}

function ptyEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = { ...env };
  // Never trap an interactive user shell with a test/devcontainer /dev/null Git config or disabled prompts.
  if (next.GIT_CONFIG_GLOBAL === "/dev/null") delete next.GIT_CONFIG_GLOBAL;
  if (next.GIT_TERMINAL_PROMPT === "0") delete next.GIT_TERMINAL_PROMPT;
  next.TERM = "xterm-256color";
  next.COLORTERM = "truecolor";
  if (!next.CLICOLOR) next.CLICOLOR = "1";
  if (!next.LANG && !next.LC_ALL) next.LANG = "en_US.UTF-8";
  if (!next.PROMPT_DIRTRIM) next.PROMPT_DIRTRIM = "2";
  return next;
}

async function boundedExit(exited: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Owned PTY cleanup exceeded seven seconds")),
          EXIT_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function spawnOwnedPty(options: SpawnPtyOptions): Promise<OwnedPty> {
  assertSupportedPlatform();
  const { cols, rows } = clampDimensions(options.cols, options.rows);
  const env = options.env ?? process.env;
  const shell = resolveUserShell(env, process.platform);
  const helper = posixPtyHelper();
  const child: ChildProcess = spawn(
    helper,
    [String(cols), String(rows), shell.file, ...shell.args],
    {
      cwd: options.cwd,
      env: ptyEnvironment(env),
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    },
  );
  const stdin = child.stdin;
  const stdout = child.stdout;
  const stderr = child.stderr;
  const control = child.stdio[3] as Duplex | null | undefined;
  if (!stdin || !stdout || !stderr || !control) {
    child.kill("SIGKILL");
    throw new Error("PTY helper did not provide expected stdio streams");
  }
  stdin.on("error", () => {});
  control.on("error", () => {});

  let stderrText = "";
  stderr.on("data", (chunk: Buffer) => {
    if (stderrText.length < 4096) stderrText += chunk.toString("utf8");
  });

  let info: PtyExit | undefined;
  let exitResolve!: (value: PtyExit) => void;
  const exited = new Promise<PtyExit>((resolve) => {
    exitResolve = resolve;
  });
  const finish = (value: PtyExit) => {
    if (info !== undefined) return;
    info = value;
    exitResolve(value);
  };

  let readyResolve!: (pid: number) => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<number>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  ready.catch(() => {});

  let pending = "";
  let gotReady = false;
  control.on("data", (chunk: Buffer) => {
    pending += chunk.toString("utf8");
    if (pending.length > 8 * 1024) {
      control.destroy();
      return;
    }
    for (;;) {
      const end = pending.indexOf("\n");
      if (end < 0) break;
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        if (!gotReady) {
          if (
            value.version !== 1 ||
            typeof value.pid !== "number" ||
            !Number.isSafeInteger(value.pid) ||
            value.pid <= 0
          )
            throw new Error("Invalid PTY helper handshake");
          gotReady = true;
          readyResolve(value.pid);
        } else if (value.stopped === true) {
          const code =
            typeof value.exit === "number" && Number.isSafeInteger(value.exit) ? value.exit : null;
          const signal = typeof value.signal === "string" ? value.signal : null;
          finish({ code, signal });
        }
      } catch {
        if (!gotReady) readyReject(new Error("Invalid PTY helper handshake"));
      }
    }
  });

  const helperExited = new Promise<void>((resolve) => {
    child.once("error", (error) => {
      readyReject(new Error(`Could not start PTY helper: ${error.message}`));
      finish({ code: null, signal: null });
      resolve();
    });
    child.once("exit", (code, signal) => {
      if (!gotReady) {
        const detail = stderrText.trim();
        readyReject(
          new Error(detail || `PTY helper exited before startup (${signal ?? code ?? "unknown"})`),
        );
      }
      setTimeout(() => {
        finish({ code: code === 0 ? null : code, signal });
        resolve();
      }, 25);
    });
  });

  const startup = setTimeout(
    () => readyReject(new Error("POSIX PTY helper startup exceeded five seconds")),
    STARTUP_DEADLINE_MS,
  );

  let pid: number;
  try {
    pid = await ready;
  } catch (error) {
    child.kill("SIGKILL");
    await boundedExit(helperExited).catch(() => {});
    throw error;
  } finally {
    clearTimeout(startup);
  }

  const listeners = new Set<(chunk: string) => void>();
  const decoder = new StringDecoder("utf8");
  stdout.on("data", (chunk: Buffer) => {
    const text = decoder.write(chunk);
    if (!text) return;
    for (const listener of listeners) {
      try {
        listener(text);
      } catch {
        // Isolate subscriber errors from PTY stream handling.
      }
    }
  });
  stdout.on("end", () => {
    const tail = decoder.end();
    if (!tail) return;
    for (const listener of listeners) {
      try {
        listener(tail);
      } catch {
        // Ignore subscriber error on stream end.
      }
    }
  });

  let stopping: Promise<void> | undefined;
  return {
    pid,
    shell: shell.name,
    write(data: string) {
      if (info !== undefined || stdin.destroyed) return;
      stdin.write(data);
    },
    resize(nextCols: number, nextRows: number) {
      if (info !== undefined || control.destroyed) return;
      const dims = clampDimensions(nextCols, nextRows);
      control.write(`resize ${dims.cols} ${dims.rows}\n`);
    },
    onData(listener: (chunk: string) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    exited,
    hasExited: () => info !== undefined,
    stop() {
      stopping ??= (async () => {
        if (!control.destroyed) control.end("stop\n");
        try {
          await boundedExit(helperExited);
        } catch {
          child.kill("SIGKILL");
          await boundedExit(helperExited).catch(() => {});
        }
        stdin.destroy();
        stdout.destroy();
        stderr.destroy();
        control.destroy();
        listeners.clear();
      })();
      return stopping;
    },
  };
}
