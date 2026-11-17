import { mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { _electron } from "@playwright/test";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");

/** Chromium may briefly retain a directory/image lock after Electron exits. */
export async function removeDesktopFixture(
  directory: string,
  options: { recursive: true; force?: boolean },
): Promise<void> {
  await rm(directory, {
    ...options,
    ...(process.platform === "win32" ? { maxRetries: 10, retryDelay: 100 } : {}),
  });
}

/** Launch the same app entrypoint from source or an installed package. */
export async function launchDesktop(
  directory: string,
  folder: string,
  database: string,
  minimalPath = false,
  environment: Record<string, string> = {},
) {
  const packaged = process.env.CODE60_PACKAGED_EXECUTABLE;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE" && key !== "NODE_OPTIONS")
      env[key] = value;
  }
  env.XDG_CONFIG_HOME = join(directory, "config");
  env.XDG_STATE_HOME = join(directory, "state");
  env.HOME = join(directory, "home");
  if (process.platform === "win32") env.USERPROFILE = env.HOME;
  await mkdir(env.HOME, { recursive: true });
  // Never run the developer's shell startup files during desktop tests.
  env.SHELL = join(directory, "test-shell");
  if (process.platform !== "win32")
    await writeFile(env.SHELL, '#!/bin/sh\nexec /bin/sh -c "$2"\n', { mode: 0o700 });
  if (minimalPath) {
    const bin = join(directory, "minimal-bin");
    await mkdir(bin);
    // AppImage's shell launcher needs core utilities.
    for (const command of process.platform === "win32"
      ? []
      : [
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
    for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
    env.PATH = bin;
    env.CODE60_TEST_RUNTIME_LOG = join(directory, "unexpected-runtime");
    // PATH discovery can find host runtimes in fallback folders. Shadow them with
    // failing stubs to prove that desktop startup never needs to execute either.
    for (const name of ["node", "npm"]) {
      await writeFile(
        join(bin, process.platform === "win32" ? `${name}.cmd` : name),
        process.platform === "win32"
          ? '@echo unexpected-runtime>>"%CODE60_TEST_RUNTIME_LOG%"\r\n@exit /b 127\r\n'
          : '#!/bin/sh\nprintf "%s\\n" "$0" >> "$CODE60_TEST_RUNTIME_LOG"\nexit 127\n',
        { mode: 0o700 },
      );
    }
  }
  Object.assign(env, environment);
  const launched = await _electron.launch({
    // Playwright otherwise injects --no-sandbox on Linux.
    chromiumSandbox: true,
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
  await launched.firstWindow();
  await launched.evaluate(({ app, BrowserWindow }) => {
    app.focus({ steal: true });
    BrowserWindow.getAllWindows()[0]?.focus();
  });
  return launched;
}
