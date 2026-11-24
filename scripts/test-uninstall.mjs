import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { backendSupervisor } from "../test/fixtures/backend-supervisor.mjs";
import { uninstallJourney } from "../test/fixtures/uninstall-journey.mjs";
import { acquirePayload } from "./distribution/acquire.mjs";
import { runCommand } from "./distribution/command.mjs";
import { descriptor, platform } from "./distribution/descriptor.mjs";

const execute = promisify(execFile);
await runCommand(async (cancel) => {
  if (process.argv.length > 3 || process.argv[2]?.startsWith("-"))
    throw Error("Use npm run test:uninstall -- [descriptor.json]");
  const signal = AbortSignal.any([cancel, AbortSignal.timeout(20 * 60_000)]);
  const input = resolve(process.argv[2] ?? `release/payloads/${platform()}.json`);
  const identity = descriptor(JSON.parse(await readFile(input, "utf8")));
  const archive = join(dirname(input), identity.archive.name);
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "code60 uninstall ' acceptance ")));
  const owned = await lstat(temporary, { bigint: true });
  const output = resolve("test-results/uninstall", `${Date.now()}-${process.pid}`);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const result = {
    status: "RUNNING",
    input: identity,
    node: process.versions.node,
    platform: platform(),
    nativeService: "bounded fixture only; no login/reboot certification",
  };
  let supervisor, failure;
  try {
    const home = join(temporary, "home"),
      bin = join(temporary, "bin");
    await mkdir(home, { mode: 0o700 });
    await mkdir(bin, { mode: 0o700 });
    const env = {
      HOME: home,
      PATH: [bin, dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
      SHELL: "/bin/bash",
      XDG_DATA_HOME: join(home, "data"),
      XDG_STATE_HOME: join(home, "state"),
      XDG_CONFIG_HOME: join(home, "config"),
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      CODEX_HOME: join(home, "isolated-codex"),
    };
    await mkdir(env.CODEX_HOME, { mode: 0o700 });
    await cp("test/fixtures/backend-supervisor-command.mjs", join(bin, "supervisor.mjs"));
    await chmod(join(bin, "supervisor.mjs"), 0o700);
    for (const name of ["systemctl", "launchctl", "xdg-open"])
      await symlink("supervisor.mjs", join(bin, name));
    const api = await import(pathToFileURL(resolve("build/distribution/management/index.js")).href);
    const install = () =>
      api.installManagedRelease({
        env,
        runtimeDirectory: resolve("build/distribution"),
        artifact: {
          identity,
          acquire: ({ parent }) =>
            acquirePayload(identity, {
              parent,
              signal,
              transport: () => createReadStream(archive),
            }),
        },
      });
    const installed = await install();
    await lstat(join(installed.release, "dist/management/uninstall.js"));
    const provider = join(temporary, "provider"),
      processLog = join(temporary, "processes");
    await mkdir(provider, { mode: 0o700 });
    await mkdir(processLog, { mode: 0o700 });
    for (const name of ["fake-agent.mjs", "fake-agent-app.mjs"])
      await cp(join("test/fixtures", name), join(provider, name));
    await symlink(join(installed.release, "node_modules"), join(provider, "node_modules"));
    await mkdir(join(env.XDG_CONFIG_HOME, "code60"), { recursive: true, mode: 0o700 });
    await writeFile(
      join(env.XDG_CONFIG_HOME, "code60/config.json"),
      JSON.stringify({
        agents: {
          claude: {
            command: [
              process.execPath,
              join(provider, "fake-agent.mjs"),
              "--relay",
              "--session-info",
              "--process-log",
              processLog,
            ],
          },
        },
      }),
      { mode: 0o600 },
    );
    supervisor = await backendSupervisor({
      directory: join(temporary, "supervisor"),
      application: installed.release,
      env,
      log: join(output, "backend.log"),
      allowUninstall: true,
    });
    env.CODE60_TEST_BACKEND_SOCKET = supervisor.socket;
    const cli = (args) =>
      execute(installed.launcher, args, {
        env,
        cwd: "/",
        signal,
        timeout: 60000,
        maxBuffer: 2 * 1024 ** 2,
      });
    await cli(["setup", "--yes", "--no-open"]);
    await cli(["service", "stop", "--yes"]);
    const selection = join(env.XDG_STATE_HOME, "code60/desktop.json");
    const preferences = JSON.parse(await readFile(selection, "utf8"));
    const database = join(home, "custom database.sqlite");
    await cp(preferences.database, database);
    preferences.database = database;
    preferences.uninstallFixtureUnrelated = "preserve";
    await writeFile(selection, JSON.stringify(preferences), { mode: 0o600 });
    await cli(["service", "start"]);
    const connection = async () => {
      const deadline = Date.now() + 45000;
      for (;;) {
        signal.throwIfAborted();
        const status = JSON.parse((await cli(["status"])).stdout);
        if (status.backend.available) {
          const saved = JSON.parse(
            await readFile(join(env.XDG_STATE_HOME, "code60/gateway/connection.json"), "utf8"),
          );
          assert.match(saved.origin, /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/);
          assert.equal(saved.pid, supervisor.pid());
          return { origin: saved.origin, pid: saved.pid, port: Number(new URL(saved.origin).port) };
        }
        assert.ok(Date.now() < deadline, "Installed backend readiness timed out");
        await delay(100, undefined, { signal });
      }
    };
    const browser = async (retained) => {
      const { chromium } = await import("@playwright/test");
      const path = join(temporary, "browser.json");
      await writeFile(
        path,
        JSON.stringify({
          ...(await connection()),
          directory: home,
          database,
          executable: chromium.executablePath(),
          retained,
        }),
      );
      try {
        const logs = await execute(
          process.execPath,
          [
            resolve("node_modules/@playwright/test/cli.js"),
            "test",
            "--config",
            resolve("test/uninstall.config.ts"),
          ],
          {
            env: {
              ...env,
              CODE60_UNINSTALL_BROWSER_INPUT: path,
              CODE60_UNINSTALL_BROWSER_OUTPUT: join(
                output,
                retained ? "reinstalled-browser" : "browser",
              ),
            },
            cwd: resolve("."),
            signal,
            timeout: 5 * 60_000,
            maxBuffer: 2 * 1024 ** 2,
          },
        );
        await writeFile(
          join(output, retained ? "reinstalled-browser.log" : "browser.log"),
          logs.stdout + logs.stderr,
          { mode: 0o600 },
        );
      } catch (error) {
        await writeFile(
          join(output, retained ? "reinstalled-browser.log" : "browser.log"),
          `${error.stdout ?? ""}${error.stderr ?? ""}`,
          { mode: 0o600 },
        );
        throw error;
      }
    };
    await browser(false);
    result.checks = (
      await uninstallJourney({
        root: installed.root,
        application: installed.release,
        launcher: installed.launcher,
        env,
        selection,
        database,
        project: join(home, "project with spaces"),
        processLog,
        connection,
        install,
        output,
        signal,
      })
    ).result;
    await browser(true);
    const model = await execute(
      process.execPath,
      [resolve("scripts/distribution/probe-native.mjs"), installed.release],
      { env, cwd: "/", signal, timeout: 120000, maxBuffer: 2 * 1024 ** 2 },
    );
    await writeFile(join(output, "native-models.log"), model.stdout + model.stderr, {
      mode: 0o600,
    });
    result.status = "PASS";
  } catch (error) {
    failure = error;
    result.status = "FAIL";
    result.error = error.message;
  } finally {
    const errors = [];
    try {
      if (supervisor) {
        await supervisor.close();
        result.backendExited = supervisor.pid() === null;
      }
      const processLog = join(temporary, "processes");
      result.providerCleanup = [];
      const names = await readdir(processLog).catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return [];
      });
      for (const name of names) {
        const { pid } = JSON.parse(await readFile(join(processLog, name), "utf8"));
        assert.ok(Number.isSafeInteger(pid) && pid > 0);
        assert.throws(
          () => process.kill(pid, 0),
          (error) => error.code === "ESRCH",
        );
        result.providerCleanup.push({ pid, exited: true });
      }
    } catch (error) {
      errors.push(error);
    }
    try {
      assert.equal(
        errors.length,
        0,
        "Preserved isolated state because owned process cleanup was not verified",
      );
      const observed = await lstat(temporary, { bigint: true });
      assert.ok(
        observed.isDirectory() &&
          !observed.isSymbolicLink() &&
          observed.dev === owned.dev &&
          observed.ino === owned.ino &&
          observed.uid === owned.uid,
        "Uninstall fixture cleanup ownership changed",
      );
      await rm(temporary, { recursive: true });
      await assert.rejects(lstat(temporary), { code: "ENOENT" });
      result.ownedStagingRemoved = true;
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) {
      result.status = "FAIL";
      failure = new AggregateError(
        [...(failure ? [failure] : []), ...errors],
        "Uninstall acceptance cleanup failed",
      );
    }
    await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
  }
  if (failure) throw failure;
  console.log(`Installed uninstall acceptance: ${output}`);
});
