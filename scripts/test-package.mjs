import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveCommand } from "../dist/platform/index.js";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const archive = resolve(process.argv[2] ?? `release/build/code60-${manifest.version}.tgz`);
await stat(archive).catch(() => {
  throw new Error("Build the npm tarball first with npm run package:app.");
});
const prefix = await mkdtemp(join(tmpdir(), "code60-package-"));
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
  const api = await import(pathToFileURL(join(root, "dist/gateway/index.js")).href);
  const isolated = join(prefix, "fixture");
  gateway = await api.startGateway({
    env: {
      ...process.env,
      HOME: prefix,
      SHELL: "/bin/sh",
      XDG_STATE_HOME: join(isolated, "state"),
      XDG_CONFIG_HOME: join(isolated, "config"),
    },
    roots: [prefix],
  });
  assert.equal((await fetch(gateway.origin)).status, 200);
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
