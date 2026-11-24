import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveCommand } from "../dist/platform/index.js";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const archive = resolve(process.argv[2] ?? `release/build/code60-${manifest.version}.tgz`);
await stat(archive).catch(() => {
  throw new Error("Build the npm tarball first with npm run package:app.");
});
const prefix = await realpath(await mkdtemp(join(tmpdir(), "code60-package-")));
let gateway;
try {
  const command = await resolveCommand([
    "npm",
    "install",
    "--prefix",
    prefix,
    "--omit=dev",
    "--no-audit",
    "--no-fund",
    archive,
  ]);
  execFileSync(command.file, command.args, {
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const root = join(prefix, "node_modules/code60");
  const installed = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(installed.engines.node, ">=24 <25");
  assert.equal(installed.dependencies.electron, undefined);
  assert.equal(installed.dependencies["electron-updater"], undefined);
  const help = execFileSync(process.execPath, [join(root, installed.bin.code60), "--help"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.match(help, /code60 service/);
  assert.match(help, /code60 pairing/);
  const api = await import(pathToFileURL(join(root, "dist/gateway/index.js")).href);
  const isolated = join(prefix, "fixture");
  const env = {
    ...process.env,
    HOME: prefix,
    SHELL: "/bin/sh",
    XDG_STATE_HOME: join(isolated, "state"),
    XDG_CONFIG_HOME: join(isolated, "config"),
    XDG_DATA_HOME: join(isolated, "data"),
  };
  if (process.platform === "darwin" && process.arch === "arm64") {
    const bundles = await readdir(join(root, "dist/engines"));
    assert.equal(bundles.length, 1);
    assert.match(bundles[0], /^[a-f0-9]{64}$/);
    const engine = await import(pathToFileURL(join(root, "dist/platform/index.js")).href);
    await engine.preserveTransmissionBundle(join(root, "dist/engines", bundles[0]), env);
    for (const version of ["0.1.0-staging.18", "0.1.0-staging.20"]) {
      const cached = await engine.resolveTransmissionRuntime(env, version);
      assert.ok(cached.root.startsWith(`${env.XDG_DATA_HOME}/code60/engines/`));
      assert.ok((await stat(cached.entry)).isFile());
    }
    assert.equal(await stat(join(isolated, "state/code60/workflows")).catch(() => null), null);
  } else {
    assert.equal(await stat(join(root, "dist/engines")).catch(() => null), null);
  }
  const policy = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [join(root, installed.bin.code60), "pairing", ...args], {
        env,
        encoding: "utf8",
        timeout: 10_000,
      }),
    );
  assert.equal(policy("status").requirePairing, false);
  assert.equal(policy("on", "--yes").requirePairing, true);
  assert.equal(policy("off", "--yes").requirePairing, false);
  gateway = await api.startGateway({
    env,
    roots: [prefix],
  });
  assert.equal((await fetch(gateway.origin)).status, 200);
  assert.equal(gateway.requirePairing, false);
  const connection = await fetch(`${gateway.origin}/api/connect`, {
    method: "POST",
    headers: { Origin: gateway.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ version: 1 }),
  });
  assert.equal(connection.status, 200);
  assert.equal((await connection.json()).controlling, true);
  const { loadRagModel } = await import(
    pathToFileURL(join(root, "dist/application/rag-model.js")).href
  );
  const network = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Network forbidden during installed-model smoke");
  };
  try {
    const embedder = await loadRagModel(join(root, "models"));
    assert.equal((await embedder.embedQuery("installed offline model")).length, 768);
  } finally {
    globalThis.fetch = network;
  }
  process.stdout.write(
    "Installed npm package: CLI, assets, backend and offline model passed. No service was installed.\n",
  );
} finally {
  await gateway?.stop();
  await rm(prefix, { recursive: true, force: true });
}
