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
  readlink,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { backendSupervisor } from "../test/fixtures/backend-supervisor.mjs";
import { acquirePayload, sha256 } from "./distribution/acquire.mjs";
import { runCommand } from "./distribution/command.mjs";
import { descriptor, platform } from "./distribution/descriptor.mjs";
import { updateFixture } from "./distribution/update-fixture.mjs";

const execute = promisify(execFile);
await runCommand(async (cancel) => {
  // Internal clean-customer preparation only. The installed product receives no
  // transport/destination environment override. Its browser driver is separate.
  const handoff = process.env.CODE60_ACCEPTANCE_UPDATE_HANDOFF === "1";
  if (handoff && (process.platform !== "linux" || process.env.TMPDIR !== "/work"))
    throw Error("Update handoff requires the isolated Linux acceptance volumes");
  if (process.argv.length > 3 || process.argv[2]?.startsWith("-"))
    throw Error("Use npm run test:update -- [descriptor.json]");
  const signal = AbortSignal.any([cancel, AbortSignal.timeout(20 * 60_000)]);
  const input = resolve(process.argv[2] ?? `release/payloads/${platform()}.json`);
  const identity = descriptor(JSON.parse(await readFile(input, "utf8")));
  const inputArchive = handoff ? "/input/package.tgz" : join(dirname(input), identity.archive.name);
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "code60 update ' acceptance ")));
  const temporaryIdentity = await lstat(temporary, { bigint: true });
  const processLog = join(temporary, "processes");
  const removeTemporary = async () => {
    const observed = await lstat(temporary, { bigint: true });
    if (
      !observed.isDirectory() ||
      observed.isSymbolicLink() ||
      observed.dev !== temporaryIdentity.dev ||
      observed.ino !== temporaryIdentity.ino ||
      observed.uid !== temporaryIdentity.uid
    )
      throw Error("Update fixture cleanup ownership changed");
    await rm(temporary, { recursive: true });
  };
  const output = handoff
    ? "/evidence/update"
    : resolve("test-results/update", `${Date.now()}-${process.pid}`);
  await mkdir(output, { recursive: true, mode: 0o700 });
  let supervisor, server, failure;
  const result = {
    status: "RUNNING",
    input: identity,
    platform: platform(),
    node: process.versions.node,
    classification: handoff
      ? "offline installed update preparation; separate isolated driver owns the golden journey"
      : "installed runtime and full shared browser golden journey; real login/reboot certification is separate",
  };
  try {
    const fixture = await updateFixture(
      identity,
      temporary,
      () => createReadStream(inputArchive),
      signal,
    );
    result.candidate = fixture.descriptor;
    result.syntheticVersionFixture = true;
    result.distinctCandidateEngineManifest = fixture.distinctEngineManifest;
    const home = handoff ? "/work/home" : join(temporary, "home"),
      bin = join(temporary, "bin");
    await mkdir(home, { mode: 0o700 });
    await mkdir(bin, { mode: 0o700 });
    const env = {
      HOME: home,
      PATH: [bin, dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
      SHELL: "/bin/bash",
      XDG_DATA_HOME: handoff ? "/installation" : join(home, "data"),
      XDG_STATE_HOME: join(home, "state"),
      XDG_CONFIG_HOME: join(home, "config"),
      CODEX_HOME: join(home, "isolated-codex"),
    };
    await mkdir(env.CODEX_HOME, { mode: 0o700 });
    await cp("test/fixtures/backend-supervisor-command.mjs", join(bin, "supervisor.mjs"));
    await chmod(join(bin, "supervisor.mjs"), 0o700);
    for (const name of ["systemctl", "launchctl", "xdg-open"])
      await symlink("supervisor.mjs", join(bin, name));
    const installer = await import(
      pathToFileURL(resolve("build/distribution/management/index.js")).href
    );
    const installed = await installer.installManagedRelease({
      env,
      runtimeDirectory: resolve("build/distribution"),
      artifact: {
        identity,
        acquire: ({ parent }) =>
          acquirePayload(identity, {
            parent,
            signal,
            transport: () => createReadStream(inputArchive),
          }),
      },
    });
    const root = installed.root,
      launcher = installed.launcher;
    const provider = join(temporary, "provider");
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
    assert.ok(
      (await stat(join(installed.release, "dist/management/update.js"))).isFile(),
      "Build the current update-capable payload before acceptance",
    );
    const candidateApplication = join(root, "releases", fixture.descriptor.archive.sha256);
    supervisor = await backendSupervisor({
      directory: join(temporary, "supervisor"),
      application: installed.release,
      candidateApplication,
      env,
      log: join(output, "backend.log"),
    });
    env.CODE60_TEST_BACKEND_SOCKET = supervisor.socket;
    const command = async (file, args, timeout = 120000) =>
      execute(file, args, { env, cwd: "/", signal, timeout, maxBuffer: 1024 ** 2 });
    const cli = async (args) => (await command(launcher, args)).stdout;
    await cli(["setup", "--yes", "--no-open"]);
    await cli(["service", "stop", "--yes"]);
    const selection = join(env.XDG_STATE_HOME, "code60/desktop.json");
    const custom = join(home, "custom database.sqlite");
    const preferences = JSON.parse(await readFile(selection, "utf8"));
    await cp(preferences.database, custom);
    preferences.database = custom;
    preferences.updateFixtureUnrelated = "preserve";
    await writeFile(selection, JSON.stringify(preferences), { mode: 0o600 });
    await cli(["service", "start"]);
    const deadline = Date.now() + 30000;
    let beforeStatus;
    while (Date.now() < deadline) {
      beforeStatus = JSON.parse(await cli(["status"]));
      if (beforeStatus.backend.available) break;
      await delay(100, undefined, { signal });
    }
    assert.equal(beforeStatus.backend.available, true);
    assert.equal(beforeStatus.database.state, "ready");
    const prior = await readlink(join(root, "current"));
    const previousReceipt = await readFile(join(root, prior, "receipt.json"));
    let beforePid = supervisor.pid();
    assert.ok(beforePid);
    const databaseHash = await sha256(custom, signal);
    const engineBindings = {};
    for (const version of process.platform === "linux"
      ? ["0.1.1"]
      : ["0.1.0-staging.18", "0.1.0-staging.20"])
      engineBindings[version] = await readFile(join(root, "engines", `${version}.json`), "utf8");
    const requests = [];
    let announceMetadata;
    const metadataRequested = new Promise((resolveMetadata) => {
      announceMetadata = resolveMetadata;
    });
    let releaseMetadata;
    const metadataGate = new Promise((resolveMetadata) => {
      releaseMetadata = resolveMetadata;
    });
    let firstMetadata = false;
    let corruptIntegrity = false;
    const registryMetadata = () =>
      JSON.stringify(
        corruptIntegrity
          ? {
              ...fixture.registry,
              dist: {
                ...fixture.registry.dist,
                integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
              },
            }
          : fixture.registry,
      );
    server = createServer((request, response) => {
      requests.push(request.url);
      if (request.url === "/metadata") {
        response.setHeader("Content-Type", "application/json");
        if (firstMetadata) {
          firstMetadata = false;
          announceMetadata();
          void metadataGate.then(() => response.end(registryMetadata()));
        } else response.end(registryMetadata());
        return;
      }
      const file =
        request.url === "/bootstrap"
          ? fixture.bootstrap
          : request.url === "/payload"
            ? fixture.archive
            : null;
      if (!file) {
        response.statusCode = 404;
        response.end();
        return;
      }
      createReadStream(file)
        .on("error", () => response.destroy())
        .pipe(response);
    });
    await new Promise((resolveStart, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolveStart);
    });
    const configPath = join(temporary, "update.json");
    const config = {
      application: installed.release,
      version: fixture.descriptor.version,
      payloadUrl: fixture.descriptor.archive.url,
      origin: `http://127.0.0.1:${server.address().port}`,
      progressLog: join(output, "progress.jsonl"),
    };
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    const entry = resolve("test/fixtures/update-command.mjs");
    const faultEvidence = [];
    corruptIntegrity = true;
    await assert.rejects(
      command(process.execPath, [entry, configPath, "--yes"]),
      (error) => error.code === 1 && error.stderr.includes("integrity mismatch"),
    );
    corruptIntegrity = false;
    assert.equal(supervisor.pid(), beforePid);
    assert.equal(await readlink(join(root, "current")), prior);
    faultEvidence.push({ scenario: "registry integrity failure", previousPidPreserved: true });
    const declined = await command(process.execPath, [entry, configPath]);
    assert.match(declined.stdout, /Update declined/);
    assert.equal(supervisor.pid(), beforePid);
    assert.equal(await readlink(join(root, "current")), prior);
    faultEvidence.push({ scenario: "non-TTY decline", previousPidPreserved: true });
    for (const phase of ["prepared", "stopped"]) {
      config.interruptPhase = phase;
      await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
      await assert.rejects(
        command(process.execPath, [entry, configPath, "--yes"]),
        (error) => error.code === 130,
      );
      assert.equal(await readlink(join(root, "current")), prior);
      delete config.interruptPhase;
      await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
      if (phase === "prepared") assert.equal(supervisor.pid(), beforePid);
      else {
        assert.equal(supervisor.pid(), null);
        const count = requests.length;
        const recovered = await command(process.execPath, [entry, configPath, "recover", "--yes"]);
        assert.match(recovered.stdout, /recovered/);
        assert.equal(requests.length, count);
        assert.ok(supervisor.pid());
        assert.notEqual(supervisor.pid(), beforePid);
        assert.throws(
          () => process.kill(beforePid, 0),
          (error) => error.code === "ESRCH",
        );
        beforePid = supervisor.pid();
      }
      assert.equal(await sha256(custom, signal), databaseHash);
      faultEvidence.push({
        scenario: `SIGINT after ${phase}`,
        exitCode: 130,
        previousActivationPreserved: true,
        explicitRecoveryWithoutAcquisition: phase === "stopped",
      });
    }
    await writeFile(join(output, "faults.json"), JSON.stringify(faultEvidence, null, 2), {
      mode: 0o600,
    });
    const requestsBeforeContention = requests.length;
    firstMetadata = true;
    const updating = command(process.execPath, [entry, configPath, "--yes"], 10 * 60_000);
    void updating.catch(() => {});
    let updated;
    try {
      await Promise.race([
        metadataRequested,
        updating.then(() => {
          throw Error("Update completed before the contention checkpoint");
        }),
      ]);
      await assert.rejects(
        command(process.execPath, [entry, configPath, "--yes"]),
        (error) => error.code === 1 && error.stderr.includes("busy or uncertain"),
      );
      assert.equal(requests.length, requestsBeforeContention + 1);
      assert.equal(supervisor.pid(), beforePid);
      releaseMetadata();
      updated = await updating;
    } finally {
      releaseMetadata();
    }
    await writeFile(join(output, "update.log"), updated.stdout + updated.stderr, { mode: 0o600 });
    assert.match(updated.stdout, /is ready/);
    const current = await readlink(join(root, "current"));
    assert.notEqual(current, prior);
    const receipt = JSON.parse(await readFile(join(root, current, "receipt.json"), "utf8"));
    assert.equal(receipt.release.version, fixture.descriptor.version);
    assert.equal(receipt.release.path, candidateApplication);
    assert.deepEqual(await readFile(join(root, prior, "receipt.json")), previousReceipt);
    assert.notEqual(supervisor.pid(), beforePid);
    assert.throws(
      () => process.kill(beforePid, 0),
      (error) => error.code === "ESRCH",
    );
    assert.equal(await sha256(custom, signal), databaseHash);
    const retained = JSON.parse(await readFile(selection, "utf8"));
    assert.equal(retained.database, custom);
    assert.equal(retained.updateFixtureUnrelated, "preserve");
    const database = new DatabaseSync(custom, { readOnly: true });
    try {
      assert.ok(
        database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().length > 0,
      );
    } finally {
      database.close();
    }
    for (const [version, binding] of Object.entries(engineBindings))
      assert.equal(await readFile(join(root, "engines", `${version}.json`), "utf8"), binding);
    const newPid = supervisor.pid();
    config.application = candidateApplication;
    await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
    const noop = await command(process.execPath, [entry, configPath, "--yes"]);
    assert.match(noop.stdout, /no changes made/);
    assert.equal(supervisor.pid(), newPid);
    await rm(fixture.archive);
    await rm(fixture.bootstrap);
    await rm(join(temporary, "registry-source"), { recursive: true });
    const count = requests.length;
    const status = await command(process.execPath, [entry, configPath, "status"]);
    assert.equal(JSON.parse(status.stdout).installedVersion, fixture.descriptor.version);
    assert.equal(requests.length, count);
    assert.match(await cli(["--help"]), /code60 update/);
    const probe = await command(process.execPath, [
      resolve("scripts/distribution/probe-native.mjs"),
      candidateApplication,
    ]);
    await writeFile(join(output, "native-models.log"), probe.stdout + probe.stderr, {
      mode: 0o600,
    });
    await unlink(join(provider, "node_modules"));
    await symlink(join(candidateApplication, "node_modules"), join(provider, "node_modules"));
    if (!handoff) {
      const { chromium } = await import("@playwright/test");
      const connection = JSON.parse(
        await readFile(join(env.XDG_STATE_HOME, "code60/gateway/connection.json"), "utf8"),
      );
      const browserInput = join(temporary, "browser.json");
      await writeFile(
        browserInput,
        JSON.stringify({
          origin: connection.origin,
          directory: home,
          database: custom,
          executable: chromium.executablePath(),
        }),
        { mode: 0o600 },
      );
      const browserOutput = join(output, "browser");
      const browserResult = await execute(
        process.execPath,
        [
          resolve("node_modules/@playwright/test/cli.js"),
          "test",
          "--config",
          resolve("test/update.config.ts"),
        ],
        {
          env: {
            ...env,
            CODE60_UPDATE_BROWSER_INPUT: browserInput,
            CODE60_UPDATE_BROWSER_OUTPUT: browserOutput,
          },
          cwd: resolve("."),
          signal,
          timeout: 5 * 60_000,
          maxBuffer: 1024 ** 2,
        },
      ).catch(async (error) => {
        await writeFile(join(output, "browser.log"), `${error.stdout ?? ""}${error.stderr ?? ""}`, {
          mode: 0o600,
        });
        throw error;
      });
      await writeFile(join(output, "browser.log"), browserResult.stdout + browserResult.stderr, {
        mode: 0o600,
      });
    } else {
      await mkdir("/work/control", { recursive: true, mode: 0o700 });
      await writeFile(
        "/work/control/update-layout.json",
        JSON.stringify({
          application: candidateApplication,
          launcher,
          home,
          setupDatabase: custom,
          fakeAgent: join(provider, "fake-agent.mjs"),
          version: fixture.descriptor.version,
          archiveSha256: fixture.descriptor.archive.sha256,
        }),
        { mode: 0o600 },
      );
    }
    for (const profile of [".bash_profile", ".bashrc", ".zprofile", ".zshrc"])
      await assert.rejects(stat(join(home, profile)), { code: "ENOENT" });
    result.checks = {
      oldPidExited: true,
      newPid,
      previousGeneration: prior,
      currentGeneration: current,
      customDatabaseSha256: databaseHash,
      customSelectionPreserved: true,
      unrelatedPreferencesPreserved: true,
      engineBindingsPreserved: Object.keys(engineBindings),
      cachesRemoved: true,
      noOpPreservesPid: true,
      concurrentAttemptRejectedBeforeAcquisition: true,
      readOnlyStatus: true,
      offlineModels: true,
      unchangedProfiles: true,
      browserGoldenJourney: !handoff,
      externalDriverPending: handoff,
      faultEvidence,
      requests,
    };
    await writeFile(join(output, "supervisor.json"), JSON.stringify(supervisor.calls, null, 2));
    result.status = "PASS";
  } catch (error) {
    failure = error;
    result.status = "FAIL";
    result.error = error.message;
  } finally {
    const errors = [];
    if (supervisor)
      try {
        await supervisor.close();
        result.backendExited = supervisor.pid() === null;
        const processes = [];
        for (const name of await readdir(processLog)) {
          const value = JSON.parse(await readFile(join(processLog, name), "utf8"));
          assert.ok(Number.isSafeInteger(value.pid) && value.pid > 0);
          assert.throws(
            () => process.kill(value.pid, 0),
            (error) => error.code === "ESRCH",
          );
          processes.push({ pid: value.pid, exited: true });
        }
        if (result.checks?.browserGoldenJourney)
          assert.ok(processes.length > 0, "Provider process evidence is missing");
        result.providerProcesses = processes;
      } catch (error) {
        errors.push(error);
      }
    if (server)
      try {
        server.closeAllConnections();
        await new Promise((resolveClose, reject) =>
          server.close((error) => (error ? reject(error) : resolveClose())),
        );
      } catch (error) {
        errors.push(error);
      }
    try {
      if (!handoff) {
        await removeTemporary();
        result.ownedStagingRemoved = true;
      } else result.ownedStateRetainedForDriver = true;
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) {
      result.status = "FAIL";
      failure = new AggregateError(
        [...(failure ? [failure] : []), ...errors],
        "Update acceptance cleanup failed",
      );
    }
    await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
  }
  if (failure) throw failure;
  console.log(`Installed update acceptance: ${output}`);
});
