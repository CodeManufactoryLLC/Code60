import { execFile } from "node:child_process";
import { access, constants, readdir, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repository = fileURLToPath(new URL("..", import.meta.url));
const hooksPath = ".githooks";

/** Only explicit install/uninstall changes repository-local Git configuration. */
export async function manageHooks(directory, action, env = process.env) {
  if (!["install", "status", "uninstall"].includes(action))
    throw new Error("Use hooks:install, hooks:status, or hooks:uninstall.");
  const root = await realpath(directory);
  const git = async (...args) =>
    (
      await execute("git", ["-C", root, ...args], { env, timeout: 5000, maxBuffer: 64 * 1024 })
    ).stdout.replace(/\r?\n$/, "");
  if ((await realpath(await git("rev-parse", "--show-toplevel"))) !== root)
    throw new Error("Run hook management at the repository root.");
  const setting = async (scope) => {
    try {
      // A NUL terminator preserves whitespace in the actual configured value.
      return (await git("config", ...scope, "--null", "--get-all", "core.hooksPath")).replace(
        /\0$/,
        "",
      );
    } catch (error) {
      if (error.code === 1) return null;
      throw error;
    }
  };
  const effective = await setting([]);
  const local = await setting(["--local"]);
  if (action === "status")
    return {
      state:
        local === hooksPath && effective === hooksPath
          ? "installed"
          : effective !== null
            ? "conflict"
            : "not-installed",
    };
  if (action === "uninstall") {
    if (local !== hooksPath || effective !== hooksPath)
      throw new Error("Refusing to unset hooks not installed by this project.");
    await git("config", "--local", "--unset", "core.hooksPath");
    return { state: "not-installed" };
  }
  if (local === hooksPath && effective === hooksPath) return { state: "installed" };
  if (effective !== null || local !== null)
    throw new Error(
      "Existing core.hooksPath configuration must be preserved. Resolve it manually.",
    );
  const defaultHooks = resolve(root, await git("rev-parse", "--git-path", "hooks"));
  for (const entry of await readdir(defaultHooks, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })) {
    if (entry.name.endsWith(".sample")) continue;
    const info = await stat(join(defaultHooks, entry.name));
    if (info.isFile() && (process.platform === "win32" || (info.mode & 0o111) !== 0))
      throw new Error("Existing active Git hooks would be hidden. Resolve them manually.");
  }
  await access(
    join(root, hooksPath, "pre-commit"),
    process.platform === "win32" ? constants.F_OK : constants.X_OK,
  );
  await git("config", "--local", "core.hooksPath", hooksPath);
  return { state: "installed" };
}

if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1])).catch(() => null)) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(JSON.stringify(await manageHooks(repository, process.argv[2])));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
