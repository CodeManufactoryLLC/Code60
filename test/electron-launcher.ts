import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { _electron, test } from "@playwright/test";

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
  env.CODE60_NATIVE_DIAG = "1";
  const launched = await _electron.launch({
    // Playwright otherwise injects --no-sandbox on Linux.
    chromiumSandbox: true,
    executablePath: packaged ? resolve(packaged) : (require("electron") as string),
    args: [...(packaged ? [] : [root]), `--user-data-dir=${join(directory, "user-data")}`],
    cwd: directory,
    env,
  });
  launched.process().on("exit", (code) => {
    process.stderr.write(`${JSON.stringify({ nativePhase: "launcher.exit", code })}\n`);
  });
  launched.process().on("close", (code) => {
    process.stderr.write(`${JSON.stringify({ nativePhase: "launcher.close", code })}\n`);
  });
  let diagnosticBuffer = "";
  let sampledQuit = false;
  launched.process().stderr?.on("data", (chunk: Buffer) => {
    diagnosticBuffer += chunk.toString();
    const lines = diagnosticBuffer.split("\n");
    diagnosticBuffer = (lines.pop() ?? "").slice(-65536);
    for (const line of lines) {
      if (line.startsWith('{"nativePhase":') || line.startsWith('{"nativeDialog":')) {
        process.stderr.write(`${line}\n`);
        const pid = launched.process().pid;
        if (
          process.platform === "win32" &&
          pid &&
          !sampledQuit &&
          line.startsWith('{"nativePhase":"app.quit-event"')
        ) {
          sampledQuit = true;
          const startedAt = performance.now();
          // One read-only OS snapshot after quit, scoped to this launcher's tree.
          // No command lines, paths, environments, user names or unrelated PIDs.
          execFile(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name)
              $owned = New-Object 'System.Collections.Generic.HashSet[uint32]'
              [void]$owned.Add(${pid})
              do {
                $added = $false
                foreach ($p in $all) {
                  if ($owned.Contains([uint32]$p.ParentProcessId) -and $owned.Add([uint32]$p.ProcessId)) { $added = $true }
                }
              } while ($added)
              $tree = @($all | Where-Object { $owned.Contains([uint32]$_.ProcessId) } | ForEach-Object {
                $kind = switch ($_.Name) {
                  'electron.exe' { 'electron' }
                  'cmd.exe' { 'shell' }
                  'node.exe' { 'node' }
                  'code60-host.exe' { 'helper' }
                  default { 'other' }
                }
                [pscustomobject]@{ pid = $_.ProcessId; parent = $_.ParentProcessId; kind = $kind }
              })
              ConvertTo-Json -Compress -InputObject $tree`,
            ],
            { windowsHide: true, timeout: 5000 },
            (error, stdout) => {
              let tree: unknown;
              try {
                tree = JSON.parse(stdout);
              } catch {}
              process.stderr.write(
                `${JSON.stringify({
                  nativePhase: "launcher.process-tree",
                  state: error ? "failed" : "succeeded",
                  elapsed: performance.now() - startedAt,
                  root: pid,
                  tree,
                })}\n`,
              );
            },
          );
        }
      }
    }
  });
  await launched.context().tracing.start({ snapshots: true, screenshots: true, sources: true });
  const close = launched.close.bind(launched);
  launched.close = async () => {
    const trace = test.info().outputPath(`browser-${randomUUID()}.zip`);
    await launched.context().tracing.stop({ path: trace });
    await test
      .info()
      .attach("native-browser-trace", { path: trace, contentType: "application/zip" });
    await close();
  };
  await launched.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.folder] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.database });
      dialog.showMessageBox = async (options) => {
        process.stderr.write(
          `${JSON.stringify({
            nativeDialog:
              "message" in options &&
              options.message === "Could not stop all agents. Try quitting again."
                ? "shutdown-failed"
                : "message" in options && options.message === "Quit Code60?"
                  ? "quit"
                  : "other",
          })}\n`,
        );
        return { response: 1, checkboxChecked: false };
      };
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
