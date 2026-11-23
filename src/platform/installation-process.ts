import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export async function installationPrerequisite(
  command: "git" | "npm",
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
) {
  await execute(command, ["--version"], {
    env,
    timeout: 5000,
    ...(signal ? { signal } : {}),
  }).catch(() => {
    throw Error(`Setup requires ${command} on PATH`);
  });
}
/** Inherit the terminal, but retain ownership until interrupted child cleanup has settled. */
export async function runInstallationCommand(
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const child = spawn(file, [...args], { env, cwd: "/", stdio: "inherit" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 20000);
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) abort();
    return await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, stopped) =>
        resolve(stopped === "SIGINT" ? 130 : stopped === "SIGTERM" ? 143 : (code ?? 1)),
      );
    });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
