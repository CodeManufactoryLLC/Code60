import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { acquirePayload } from "./distribution/acquire.mjs";
import { runCommand } from "./distribution/command.mjs";
import { descriptor, platform } from "./distribution/descriptor.mjs";

await runCommand(async (cancel) => {
  assert.equal(platform(), "darwin-arm64", "Native engine removal smoke requires macOS arm64");
  assert.ok(
    process.argv.length <= 3 && !process.argv[2]?.startsWith("-"),
    "Use node scripts/test-uninstall-engines.mjs [descriptor.json]",
  );
  const signal = AbortSignal.any([cancel, AbortSignal.timeout(7 * 60_000)]);
  const input = resolve(process.argv[2] ?? "release/payloads/darwin-arm64.json");
  const identity = descriptor(JSON.parse(await readFile(input, "utf8")));
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "code60 uninstall engines ' ")));
  const owned = await lstat(temporary, { bigint: true });
  const output = resolve("test-results/uninstall-engines", `${Date.now()}-${process.pid}`);
  await mkdir(output, { recursive: true, mode: 0o700 });
  const env = {
    HOME: temporary,
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    XDG_DATA_HOME: join(temporary, "data"),
    XDG_STATE_HOME: join(temporary, "state"),
    XDG_CONFIG_HOME: join(temporary, "config"),
    CODEX_HOME: join(temporary, "codex"),
  };
  const load = (path) => import(pathToFileURL(resolve("dist", path)).href);
  const { preserveTransmissionBundle, inspectMacRuntimeProcess, waitForRuntimeExit } =
    await load("platform/index.js");
  const { LocalTransmission } = await load("application/transmission.js");
  const { createTransmissionRemovalPorts, prepareTransmissionRemoval } = await load(
    "application/transmission-removal.js",
  );
  const ports = createTransmissionRemovalPorts();
  const root = join(temporary, "workflows");
  const started = [];
  const result = {
    status: "RUNNING",
    input: identity,
    node: process.versions.node,
    classification:
      "actual bundled idle native engine quiescence; no provider, login service or full uninstall claim",
  };
  const history = async () =>
    Promise.all(
      started.map(async ({ version, state }) => {
        const db = new DatabaseSync(join(state, "workflows.sqlite"), { readOnly: true });
        try {
          return {
            version,
            runs: db.prepare("SELECT * FROM runs").all(),
            events: db.prepare("SELECT * FROM events").all(),
          };
        } finally {
          db.close();
        }
      }),
    );
  let failure;
  try {
    const source = await acquirePayload(identity, {
      parent: temporary,
      signal,
      transport: () => createReadStream(join(dirname(input), identity.archive.name)),
    });
    const bundles = await readdir(join(source.root, "dist/engines"));
    assert.equal(bundles.length, 1);
    await preserveTransmissionBundle(join(source.root, "dist/engines", bundles[0]), env, signal);
    // Engines must run from their independent cache after the app's source disappears.
    await rm(source.owned, { recursive: true });
    for (const version of ["0.1.0-staging.18", "0.1.0-staging.20"]) {
      const state = join(root, `transmission-${version}`);
      const entry = { version, state };
      started.push(entry);
      const client = new LocalTransmission(state, env, version);
      await client.connect(signal);
      const runtime = await ports.runtime(env, version, signal);
      const health = await client.call("health", {}, signal);
      entry.command = [runtime.node, runtime.entry, "engine"];
      entry.owner = await inspectMacRuntimeProcess(health.pid, entry.command, signal);
      assert.ok(entry.owner, "Started engine must have verified native process identity");
    }
    result.before = await history();
    const proofs = await prepareTransmissionRemoval(root, env, [], signal);
    assert.equal(proofs.length, 2);
    result.processes = proofs.map(({ version, pids }) => ({ version, pids }));
    for (const proof of proofs) await proof.stop(signal);
    result.after = await history();
    assert.deepEqual(result.after, result.before);
    for (const { version, state, command } of started) {
      assert.equal(await lstat(join(state, "endpoint.json")).catch(() => null), null);
      assert.deepEqual(await ports.processes(command, signal), []);
      assert.ok(await ports.runtime(env, version, signal));
    }
    result.retainedBindingsAndState = true;
    result.status = "PASS";
  } catch (error) {
    failure = error;
    result.status = "FAIL";
    result.error = error.message;
  } finally {
    const cleanup = { processesExited: false, temporaryRemoved: false };
    try {
      const cleanupSignal = AbortSignal.timeout(60_000);
      // Test-owned empty engines may need cleanup after a failed assertion. This
      // boundary still verifies the exact runtime and authenticated endpoint;
      // it never sends an arbitrary PID termination signal.
      for (const entry of started) {
        const runtime = await ports.runtime(env, entry.version, cleanupSignal);
        const command = [runtime.node, runtime.entry, "engine"];
        const matches = await ports.processes(command, cleanupSignal);
        const endpoint = await readFile(join(entry.state, "endpoint.json"), "utf8")
          .then(JSON.parse)
          .catch((error) => {
            if (error.code !== "ENOENT") throw error;
            return null;
          });
        if (matches.length) {
          assert.equal(matches.length, 1);
          assert.ok(endpoint);
          assert.equal(
            (await ports.request(endpoint, "health", cleanupSignal)).pid,
            matches[0].pid,
          );
          if (entry.owner) assert.deepEqual(matches[0], entry.owner);
          const family = await ports.family(matches[0], cleanupSignal);
          assert.deepEqual(await ports.request(endpoint, "stop", cleanupSignal), {
            stopping: true,
          });
          await waitForRuntimeExit(family, cleanupSignal);
        } else assert.ok(endpoint === null, "Stopped engine retained a private endpoint");
        assert.deepEqual(await ports.processes(command, cleanupSignal), []);
      }
      cleanup.processesExited = true;
      const observed = await lstat(temporary, { bigint: true });
      assert.ok(observed.isDirectory() && !observed.isSymbolicLink());
      assert.equal(observed.dev, owned.dev);
      assert.equal(observed.ino, owned.ino);
      assert.equal(observed.uid, owned.uid);
      await rm(temporary, { recursive: true });
      cleanup.temporaryRemoved = true;
    } catch (error) {
      cleanup.error = error.message;
      cleanup.retained = temporary;
      failure = new AggregateError(
        [failure, error].filter(Boolean),
        "Engine smoke or owned cleanup failed; inspect retained evidence",
      );
      result.status = "FAIL";
    }
    result.cleanup = cleanup;
    await writeFile(join(output, "summary.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
  }
  if (failure) throw failure;
  console.log(`Native engine removal smoke passed; evidence: ${output}`);
});
