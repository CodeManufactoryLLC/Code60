import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { isAbsolute, join, normalize } from "node:path";

interface PathOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
  accountShell?: () => string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

function loginShell(): string | null {
  try {
    return userInfo().shell;
  } catch {
    return null;
  }
}

function absolute(value: string | undefined | null): value is string {
  return Boolean(value && isAbsolute(value) && !value.includes("\0"));
}

/** Desktop-only: recover executable search paths without importing shell credentials. */
export async function desktopPath(options: PathOptions = {}): Promise<string> {
  const env = options.env ?? process.env;
  const home = options.home ?? (absolute(env.HOME) ? env.HOME : homedir());
  const platform = options.platform ?? process.platform;
  const accountShell = absolute(env.SHELL) ? null : (options.accountShell ?? loginShell)();
  const shell = absolute(env.SHELL)
    ? env.SHELL
    : absolute(accountShell)
      ? accountShell
      : platform === "darwin"
        ? "/bin/zsh"
        : "/bin/sh";
  const recovered = await shellPath(shell, home, env, options).catch(() => undefined);
  const paths = [
    ...(recovered ?? "").split(":"),
    ...(env.PATH ?? "").split(":"),
    join(home, ".local/bin"),
    join(home, "bin"),
    ...(platform === "darwin" ? ["/opt/homebrew/bin"] : []),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  return [...new Set(paths.filter(absolute).map((path) => normalize(path)))].join(":");
}

function shellPath(
  shell: string,
  home: string,
  env: NodeJS.ProcessEnv,
  options: PathOptions,
): Promise<string | undefined> {
  if (options.signal?.aborted) return Promise.resolve(undefined);
  const marker = `CODE60_PATH_${randomUUID()}`;
  const begin = `${marker}_BEGIN\n`;
  const end = `${marker}_END\n`;
  // Fixed commands only: never interpolate project paths or agent commands into a shell.
  // Absolute utilities also work when Finder supplies no useful PATH.
  const command = `/usr/bin/printf '%s\\n' '${marker}_BEGIN'; /usr/bin/printenv PATH; /usr/bin/printf '%s\\n' '${marker}_END'`;
  return new Promise((resolve) => {
    const child = spawn(shell, ["-ilc", command], {
      cwd: home,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    let bytes = 0;
    const output: Buffer[] = [];
    const timer = setTimeout(() => finish(), options.timeoutMs ?? 3_000);
    const abort = () => finish();
    function finish(path?: string): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      // Kill the entire probe group, including background jobs from shell startup files.
      // This probe owns no user work and must never delay startup or shutdown.
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
      child.stdout.destroy();
      child.stderr.destroy();
      resolve(path);
    }
    const collect = (chunk: Buffer, keep: boolean) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > (options.maxOutputBytes ?? 64 * 1024)) finish();
      else if (keep) output.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => collect(chunk, false));
    child.once("error", () => finish());
    child.once("close", (code) => {
      if (settled) return;
      const text = Buffer.concat(output).toString("utf8");
      const start = text.indexOf(begin);
      const stop = text.indexOf(end, start + begin.length);
      const path = text.slice(start + begin.length, stop).replace(/\n$/, "");
      finish(code === 0 && start >= 0 && stop >= 0 && !/[\r\n\0]/.test(path) ? path : undefined);
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) finish();
  });
}
