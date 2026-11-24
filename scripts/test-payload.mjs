import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { acquirePayload } from "./distribution/acquire.mjs";
import { platform } from "./distribution/descriptor.mjs";

const execute = promisify(execFile);
const repository = fileURLToPath(new URL("..", import.meta.url));
const id = `${Date.now()}-${process.pid}`;
const output = join(repository, "test-results/payload", id);
let temporary;
let gateway;
let exited;
let gatewayResult;
let stopSignal;
const controller = new AbortController();
const interrupt = () => {
  stopSignal = 130;
  controller.abort();
};
const terminate = () => {
  stopSignal = 143;
  controller.abort();
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", terminate);
try {
  const workflows = process.argv[2] === "--workflows";
  if (process.argv.length > (workflows ? 4 : 3))
    throw new Error("Use npm run test:payload -- [--workflows] [descriptor.json]");
  const input = resolve(
    process.argv[workflows ? 3 : 2] ?? join(repository, "release/payloads", `${platform()}.json`),
  );
  const descriptor = JSON.parse(await readFile(input, "utf8"));
  await mkdir(output, { recursive: true, mode: 0o700 });
  temporary = await realpath(await mkdtemp(join(tmpdir(), "code60 payload smoke ")));
  const candidate = await acquirePayload(descriptor, {
    parent: temporary,
    signal: controller.signal,
    transport: () => createReadStream(join(dirname(input), descriptor.archive.name)),
  });
  if (workflows) {
    const result = await execute(
      process.execPath,
      [
        join(repository, "node_modules/@playwright/test/cli.js"),
        "test",
        "--config",
        "test/transmission-native.config.ts",
        "transmission-native.e2e.ts",
        "--output",
        join(output, "workflow"),
      ],
      {
        cwd: repository,
        env: { ...process.env, CODE60_TEST_INSTALLED_ROOT: candidate.root },
        signal: controller.signal,
        timeout: 360_000,
        maxBuffer: 4194304,
      },
    ).catch((error) => error);
    await writeFile(join(output, "workflow.log"), result.stdout + result.stderr);
    if (result instanceof Error) throw result;
  }
  const home = join(temporary, "home");
  await mkdir(home, { mode: 0o700 });
  const env = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: home,
    SHELL: "/bin/sh",
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_STATE_HOME: join(home, "state"),
  };
  const cli = (...args) =>
    execute(process.execPath, [join(candidate.root, "dist/management/main.js"), ...args], {
      env,
      cwd: temporary,
      timeout: 15_000,
      signal: controller.signal,
      maxBuffer: 1024 ** 2,
    });
  assert.match((await cli("--help")).stdout, /code60 service/);
  assert.equal(JSON.parse((await cli("pairing", "status")).stdout).requirePairing, false);
  assert.equal(JSON.parse((await cli("pairing", "on", "--yes")).stdout).requirePairing, true);
  assert.equal(JSON.parse((await cli("pairing", "off", "--yes")).stdout).requirePairing, false);
  gateway = spawn(process.execPath, [join(candidate.root, "dist/gateway/main.js")], {
    cwd: temporary,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  for (const stream of [gateway.stdout, gateway.stderr])
    stream.on("data", (bytes) => {
      log = `${log}${bytes}`.slice(-(1024 ** 2));
    });
  exited = new Promise((ready, reject) => {
    gateway.once("error", reject);
    gateway.once("exit", (code, signal) => {
      gatewayResult = { code, signal };
      ready();
    });
  });
  void exited.catch(() => {});
  let connection;
  const deadline = Date.now() + 45_000;
  while (!connection) {
    controller.signal.throwIfAborted();
    if (gatewayResult || Date.now() > deadline) throw new Error("Payload Gateway readiness failed");
    connection = await readFile(join(env.XDG_STATE_HOME, "code60/gateway/connection.json"), "utf8")
      .then(JSON.parse)
      .catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return null;
      });
    if (!connection) await delay(100);
  }
  assert.match(connection.origin, /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/);
  const response = await fetch(connection.origin, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  const html = await response.text();
  const assets = [...html.matchAll(/(?:src|href)="((?:\.\/|\/)[^"?]+\.(?:js|css))"/g)];
  assert.ok(assets.length);
  for (const [, path] of assets)
    assert.equal(
      (await fetch(new URL(path, connection.origin), { signal: AbortSignal.timeout(5000) })).status,
      200,
    );
  const model = await execute(
    process.execPath,
    [join(repository, "scripts/distribution/probe-native.mjs"), candidate.root],
    { env, cwd: temporary, timeout: 120_000, signal: controller.signal, maxBuffer: 1024 ** 2 },
  );
  if (gatewayResult) throw new Error("Payload Gateway exited during acceptance");
  await writeFile(join(output, "model.log"), model.stdout, { mode: 0o600 });
  await writeFile(join(output, "gateway.log"), log, { mode: 0o600 });
  await chmod(join(output, "gateway.log"), 0o600);
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        descriptor,
        platform: platform(),
        cli: true,
        pairing: true,
        browserAssets: assets.length,
        dimensions: 768,
        javascriptFetch: "forbidden",
        foregroundGateway: true,
        nativeService: "not installed",
      },
      null,
      2,
    ),
  );
  console.log(`Payload smoke passed: ${output}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = stopSignal ?? 1;
} finally {
  try {
    if (gateway && !gatewayResult) {
      gateway.kill("SIGTERM");
      let timer;
      try {
        await Promise.race([
          exited,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Payload Gateway shutdown timed out")),
              25_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      assert.equal(gatewayResult.code, 0);
    }
    if (temporary) {
      await rm(temporary, { recursive: true, force: true });
      await assert.rejects(lstat(temporary), { code: "ENOENT" });
    }
    if (temporary)
      await writeFile(
        join(output, "cleanup.json"),
        JSON.stringify({
          gatewayExited: !gateway || Boolean(gatewayResult),
          temporaryRemoved: true,
        }),
      );
  } catch (error) {
    console.error(`Payload cleanup failed: ${error.message}`);
    process.exitCode = stopSignal ?? 1;
  }
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", terminate);
  if (stopSignal) process.exitCode = stopSignal;
}
