import { mkdir, stat, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { _electron } from "@playwright/test";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");

/** Launch the same app entrypoint from source or an installed package. */
export async function launchDesktop(
  directory: string,
  folder: string,
  database: string,
  minimalPath = false,
) {
  const packaged = process.env.CODE60_PACKAGED_EXECUTABLE;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE" && key !== "NODE_OPTIONS")
      env[key] = value;
  }
  env.XDG_CONFIG_HOME = join(directory, "config");
  env.XDG_STATE_HOME = join(directory, "state");
  if (minimalPath) {
    const bin = join(directory, "minimal-bin");
    await mkdir(bin);
    // AppImage's shell launcher needs core utilities; deliberately omit node/npm.
    for (const command of [
      "bash",
      "true",
      "unshare",
      "cat",
      "ls",
      "dirname",
      "basename",
      "readlink",
      "realpath",
      "uname",
      "sed",
      "grep",
      "head",
      "tr",
      "cut",
      "which",
      "env",
      "fusermount",
      "fusermount3",
    ]) {
      for (const base of ["/usr/bin", "/bin"]) {
        try {
          await stat(join(base, command));
          await symlink(join(base, command), join(bin, command));
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
    env.PATH = bin;
  }
  const launched = await _electron.launch({
    executablePath: packaged ? resolve(packaged) : (require("electron") as string),
    args: [...(packaged ? [] : [root]), `--user-data-dir=${join(directory, "user-data")}`],
    cwd: directory,
    env,
  });
  await launched.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.folder] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.database });
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    },
    { folder, database },
  );
  return launched;
}
