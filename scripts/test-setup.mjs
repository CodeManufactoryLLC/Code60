import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  chmod,
  cp,
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
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { backendSupervisor } from "../test/fixtures/backend-supervisor.mjs";
import { bootstrapAdapter } from "./distribution/bootstrap-adapter.mjs";
import { writeBootstrapVerifier } from "./distribution/copy-verifier.mjs";
import { descriptor } from "./distribution/descriptor.mjs";

const execute = promisify(execFile);
if (process.argv.length > 3) throw Error("Use npm run test:setup -- [descriptor.json]");
const input = resolve(
  process.argv[2] ?? `release/payloads/${process.platform}-${process.arch}.json`,
);
const identity = descriptor(JSON.parse(await readFile(input, "utf8")));
const temporary = await realpath(await mkdtemp(join(tmpdir(), "code60 setup ' acceptance ")));
const output = resolve("test-results/setup", `${Date.now()}-${process.pid}`);
await mkdir(output, { recursive: true, mode: 0o700 });
let supervisor;
let independent;
let failure;
try {
  const home = join(temporary, "home"),
    cache = join(temporary, "bootstrap-cache"),
    bin = join(temporary, "bin");
  await mkdir(home, { mode: 0o700 });
  await mkdir(bin, { mode: 0o700 });
  await mkdir(join(cache, "lib"), { recursive: true });
  await mkdir(join(cache, "bin"));
  await cp("build/distribution", join(cache, "lib/runtime"), { recursive: true });
  await writeBootstrapVerifier(join(cache, "lib"));
  await cp("scripts/distribution/bootstrap.mjs", join(cache, "bin/code60.mjs"));
  await writeFile(join(cache, "lib/index.mjs"), bootstrapAdapter);
  await writeFile(
    join(cache, "package.json"),
    JSON.stringify({ type: "module", private: true, version: identity.version }),
  );
  await writeFile(
    join(cache, "platforms.json"),
    JSON.stringify({ [`${identity.os}-${identity.arch}`]: identity }),
  );
  await cp("test/fixtures/backend-supervisor-command.mjs", join(bin, "supervisor.mjs"));
  await chmod(join(bin, "supervisor.mjs"), 0o700);
  for (const name of ["systemctl", "launchctl", "xdg-open"])
    await symlink("supervisor.mjs", join(bin, name));
  const env = {
    HOME: home,
    PATH: [bin, dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
    SHELL: "/bin/bash",
    XDG_DATA_HOME: join(home, "data"),
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_STATE_HOME: join(home, "state"),
    CODEX_HOME: join(home, "workflow-codex"),
  };
  await mkdir(env.CODEX_HOME, { mode: 0o700 });
  const application = join(env.XDG_DATA_HOME, "code60/releases", identity.archive.sha256);
  supervisor = await backendSupervisor({
    directory: join(temporary, "supervisor"),
    application,
    env,
    log: join(output, "backend.log"),
  });
  env.CODE60_TEST_BACKEND_SOCKET = supervisor.socket;
  const { bootstrapMain } = await import(pathToFileURL(join(cache, "bin/code60.mjs")).href);
  const options = {
    env,
    acquisition: { transport: () => createReadStream(join(dirname(input), identity.archive.name)) },
  };
  assert.equal(await bootstrapMain(["setup", "--no-open"], options), 0);
  const launcher = join(home, ".local/bin/code60"),
    database = join(env.XDG_DATA_HOME, "code60/databases/default.sqlite");
  await assert.rejects(readdir(dirname(database)), { code: "ENOENT" });
  assert.equal(supervisor.pid(), null);
  assert.equal(
    await bootstrapMain(["setup", "--yes", "--no-open"], {
      ...options,
      acquisition: {
        transport: () => {
          throw Error("Healthy repeat downloaded");
        },
      },
    }),
    0,
  );
  const secondHome = join(temporary, "second-home");
  await mkdir(secondHome, { mode: 0o700 });
  const secondEnv = {
    ...env,
    HOME: secondHome,
    XDG_DATA_HOME: join(secondHome, "data"),
    XDG_STATE_HOME: join(secondHome, "state"),
    XDG_CONFIG_HOME: join(secondHome, "config"),
    CODEX_HOME: join(secondHome, "workflow-codex"),
  };
  await mkdir(secondEnv.CODEX_HOME, { mode: 0o700 });
  const secondApplication = join(
    secondEnv.XDG_DATA_HOME,
    "code60/releases",
    identity.archive.sha256,
  );
  independent = await backendSupervisor({
    directory: join(temporary, "independent-supervisor"),
    application: secondApplication,
    env: secondEnv,
    log: join(output, "independent-backend.log"),
  });
  secondEnv.CODE60_TEST_BACKEND_SOCKET = independent.socket;
  const platform = await import(pathToFileURL(join(application, "dist/platform/index.js")).href);
  const metadata = JSON.parse(await readFile(join(application, "payload.json"), "utf8"));
  await platform.preserveTransmissionBundle(
    join(application, "dist/engines", metadata.transmissionBundle),
    secondEnv,
  );
  if (process.platform === "darwin") {
    // Model an interrupted source-development cache publication before managed
    // installation. Preserve the original healthy staging.18 binding.
    await rm(join(secondEnv.XDG_DATA_HOME, "code60/engines/0.1.0-staging.20.json"));
  }
  assert.equal(
    await bootstrapMain(["setup", "--yes", "--no-open"], { ...options, env: secondEnv }),
    0,
  );
  for (const version of platform.installedEngineVersions())
    await platform.resolveTransmissionRuntime(secondEnv, version);
  const secondPid = independent.pid();
  assert.ok(secondPid);
  await rm(cache, { recursive: true });
  {
    const { resolveTransmissionRuntime, installedEngineVersions } = await import(
      pathToFileURL(join(application, "dist/platform/index.js")).href
    );
    for (const version of installedEngineVersions()) {
      const runtime = await resolveTransmissionRuntime(env, version);
      assert.ok(runtime.root.startsWith(`${env.XDG_DATA_HOME}/code60/engines/`));
      assert.ok(!runtime.entry.startsWith(`${application}/`));
      const engineState = join(env.XDG_STATE_HOME, "code60/workflows", `transmission-${version}`);
      // The pinned engine's CLI reports a missing endpoint with exit 1. It does
      // not share the installed Code60 status command's JSON contract.
      await assert.rejects(
        execute(runtime.node, [runtime.entry, "status"], {
          env: { ...env, TRANSMISSION_STATE_DIR: engineState },
          cwd: "/",
          timeout: 15000,
          maxBuffer: 16384,
        }),
        (error) => error.code === 1 && error.stderr.includes(join(engineState, "endpoint.json")),
      );
      await assert.rejects(readdir(engineState), { code: "ENOENT" });
      if (version !== "0.1.0-staging.18") {
        const loginHome = join(home, "codex-help");
        await mkdir(loginHome, { mode: 0o700 });
        const help = await execute(
          runtime.node,
          [join(runtime.root, "node_modules/@openai/codex/bin/codex.js"), "login", "--help"],
          {
            env: { ...env, CODEX_HOME: loginHome },
            cwd: "/",
            timeout: 15000,
            maxBuffer: 16384,
          },
        );
        assert.match(help.stdout, /login|authenticate/i);
        await assert.rejects(readFile(join(loginHome, "auth.json")), { code: "ENOENT" });
      }
    }
    console.log(
      "Preserved installed engines resolve after bootstrap removal; status remains inert",
    );
  }
  const before = await readFile(database);
  const pid = supervisor.pid();
  assert.ok(pid);
  const status = JSON.parse(
    (await execute(launcher, ["status"], { env, cwd: "/", timeout: 15000 })).stdout,
  );
  assert.equal(status.database.state, "ready");
  assert.equal(status.backend.available, true);
  assert.equal(status.installation.state, "ready");
  assert.ok(!JSON.stringify(status).includes("token"));
  await execute(launcher, ["setup", "--yes", "--no-open"], { env, cwd: "/", timeout: 45000 });
  assert.equal(supervisor.pid(), pid);
  assert.deepEqual(await readFile(database), before);
  for (const mode of ["on", "off"])
    await execute(launcher, ["pairing", mode, "--yes"], { env, cwd: "/", timeout: 15000 });
  await supervisor.stop();
  await execute(launcher, ["setup", "--yes", "--no-open"], { env, cwd: "/", timeout: 45000 });
  assert.notEqual(supervisor.pid(), pid);
  const prefs = JSON.parse(await readFile(join(env.XDG_STATE_HOME, "code60/desktop.json"), "utf8"));
  assert.equal(prefs.database, database);
  assert.equal(prefs.agentSetup, undefined);
  const recordedCalls = supervisor.calls;
  await supervisor.close();
  supervisor = undefined;
  assert.equal(independent.pid(), secondPid);
  const secondStatus = JSON.parse(
    (
      await execute(join(secondHome, ".local/bin/code60"), ["status"], {
        env: secondEnv,
        cwd: "/",
        timeout: 15000,
      })
    ).stdout,
  );
  assert.equal(secondStatus.backend.available, true);
  await independent.close();
  independent = undefined;
  const { loadRagModel } = await import(
    pathToFileURL(join(application, "dist/application/rag-model.js")).href
  );
  globalThis.fetch = () => {
    throw Error("Setup smoke forbids JavaScript fetch during embedding");
  };
  const model = await loadRagModel(join(application, "models"));
  assert.equal((await model.embedQuery("setup acceptance offline")).length, 768);
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        descriptor: identity,
        setup: true,
        declinedServiceInstalledOnly: true,
        bootstrapCacheRemoved: true,
        repeatPreservesBackend: true,
        restart: true,
        pairing: true,
        database: true,
        providerVerificationSeeded: false,
        dimensions: 768,
        nativeService: "fixture only",
        freshSingleCommand: true,
        cleanupIsolation: true,
        calls: recordedCalls,
      },
      null,
      2,
    ),
  );
  console.log(`Setup smoke passed: ${output}`);
} catch (error) {
  failure = error;
} finally {
  const failures = [];
  for (const owner of [supervisor, independent]) {
    try {
      await owner?.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (!failures.length) await rm(temporary, { recursive: true, force: true });
  await writeFile(
    join(output, "cleanup.json"),
    JSON.stringify({
      backendExited: failures.length === 0,
      temporaryRemoved: failures.length === 0,
      ...(failures.length ? { retainedState: temporary } : {}),
    }),
  );
  if (failures.length)
    failure = new AggregateError(
      [...(failure ? [failure] : []), ...failures],
      "Setup fixture cleanup failed; isolated state was preserved",
    );
}

if (failure) throw failure;
