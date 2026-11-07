import { access, open } from "node:fs/promises";
import { basename, dirname, join, win32 } from "node:path";
import { environmentValue } from "./environment.js";

export interface ExecutableCommand {
  file: string;
  args: string[];
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

function validWindowsPath(file: string): boolean {
  return (
    /^[a-z]:[\\/]/i.test(file) &&
    !/[\0\r\n]/.test(file) &&
    !file.slice(2).includes(":") &&
    file.length < 248
  );
}

async function findExecutable(file: string, env: NodeJS.ProcessEnv): Promise<string> {
  if (/[\0\r\n]/.test(file)) throw new Error("Invalid executable path");
  const hasPath = /[\\/:]/.test(file);
  if (hasPath && !validWindowsPath(file))
    throw new Error(
      "Use a local absolute Windows executable path below 248 characters, not a drive-relative or device path",
    );
  const directories = hasPath
    ? [""]
    : (environmentValue(env, "PATH", "win32") ?? "").split(";").filter(validWindowsPath);
  const extension = win32.extname(file);
  // Prefer actual executables, never search the current working directory implicitly.
  const suffixes = extension ? [""] : [".exe", ".com", ".cmd", ".bat", ""];
  for (const directory of directories) {
    for (const suffix of suffixes) {
      const candidate = hasPath ? `${file}${suffix}` : win32.join(directory, `${file}${suffix}`);
      if (await exists(candidate)) return candidate;
    }
  }
  throw new Error(`could not start '${file}': executable not found on PATH`);
}

/** cmd.exe has no general argv encoding. Reject syntax it could reinterpret. */
export function batchCommand(
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): ExecutableCommand {
  for (const value of [file, ...args]) {
    if (/["%!^&|<>()\r\n\0]/.test(value) || /\\$/.test(value))
      throw new Error(
        "This batch launcher cannot safely represent an argument. Use an executable or a standard npm/npx entry point instead.",
      );
  }
  const root = environmentValue(env, "SystemRoot", "win32");
  if (!root || !validWindowsPath(root)) throw new Error("Windows SystemRoot is unavailable");
  return {
    file: win32.join(root, "System32", "cmd.exe"),
    args: [
      "/d",
      "/s",
      "/v:off",
      "/c",
      `"${[file, ...args].map((value) => `"${value}"`).join(" ")}"`,
    ],
  };
}

/** No shell profiles, global shell mode, command interpolation, or prompt arguments. */
export async function resolveCommand(
  command: readonly [string, ...string[]],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<ExecutableCommand> {
  const [requested, ...args] = command;
  if (platform !== "win32") return { file: requested, args };
  const file = await findExecutable(requested, env);
  if (!/\.(?:cmd|bat)$/i.test(file)) return { file, args };
  const name = basename(file)
    .replace(/\.(?:cmd|bat)$/i, "")
    .toLowerCase();
  if (name === "npm" || name === "npx") {
    const base = dirname(file);
    const entry = join(base, "node_modules", "npm", "bin", `${name}-cli.js`);
    if (await exists(entry)) {
      // A standard shim must name npm's CLI. Never interpret arbitrary batch text.
      const invalid = () =>
        new Error(
          "Unrecognized npm/npx launcher; configure its Node executable and CLI entry point explicitly",
        );
      const handle = await open(file, "r");
      try {
        if (!(await handle.stat()).isFile()) throw invalid();
        const bytes = Buffer.alloc(16 * 1024 + 1);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        if (
          bytesRead > 16 * 1024 ||
          !bytes.subarray(0, bytesRead).toString("utf8").includes(`${name}-cli.js`)
        )
          throw invalid();
      } finally {
        await handle.close();
      }
      const adjacent = join(base, "node.exe");
      const node = (await exists(adjacent)) ? adjacent : await findExecutable("node.exe", env);
      return { file: node, args: [entry, ...args] };
    }
  }
  return batchCommand(file, args, env);
}
