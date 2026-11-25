import { execFileSync } from "node:child_process";
import { watch } from "node:fs";
import { createServer } from "node:net";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { developmentPort } from "./dev-ports.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const vitePort = developmentPort(process.env.CODE60_VITE_PORT, "CODE60_VITE_PORT");
const gatewayPort = developmentPort(process.env.CODE60_DEV_GATEWAY_PORT, "CODE60_DEV_GATEWAY_PORT");
if (vitePort !== undefined && vitePort === gatewayPort)
  throw new Error("Development gateway and Vite ports must differ.");
execFileSync(process.execPath, ["scripts/build-pty-helper.mjs"], {
  cwd: root,
  stdio: "inherit",
  timeout: 60_000,
});
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], {
  cwd: root,
  stdio: "inherit",
  timeout: 120_000,
});
execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
  cwd: root,
  stdio: "inherit",
  timeout: 120_000,
});
const { spawnOwnedProcess } = await import("../dist/platform/index.js");
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(vitePort ?? 0, "127.0.0.1", resolve);
});
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const dataRoot = process.env.CODE60_DEV_DATA_ROOT ?? join(root, "test-results/dev");
if (!isAbsolute(dataRoot)) throw new Error("Development data root must be absolute.");
const env = {
  ...process.env,
  XDG_STATE_HOME: join(dataRoot, "state"),
  XDG_CONFIG_HOME: join(dataRoot, "config"),
  CODE60_DEV_ASSETS: `http://127.0.0.1:${port}`,
  CODE60_VITE_PORT: String(port),
};
const children = new Set();
const expectedExits = new WeakSet();
let app;
let stopping;
let timer;
let restarting = false;
let dirty = false;
let watcher;
async function launch(args, onOutput) {
  const child = await spawnOwnedProcess([process.execPath, ...args], root, env);
  if (stopping) {
    await child.stop(0);
    throw new Error("Development startup cancelled.");
  }
  children.add(child);
  if (onOutput) child.stdout.on("data", onOutput);
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(process.stderr, { end: false });
  child.exited
    .then(async ({ code }) => {
      children.delete(child);
      await child.stop(0);
      if (args[0] === "scripts/dev-backend.mjs" && !expectedExits.has(child) && !stopping)
        await stop(code ?? 1);
    })
    .catch(() => void stop(1));
  return child;
}
async function restart() {
  if (stopping) return;
  if (restarting) {
    dirty = true;
    return;
  }
  restarting = true;
  try {
    if (app) expectedExits.add(app);
    await app?.stop(25_000);
    if (!stopping) app = await launch(["scripts/dev-backend.mjs"]);
  } catch {
    process.stderr.write("Development backend restart failed.\n");
    await stop(1);
  } finally {
    restarting = false;
    if (dirty && !stopping) {
      dirty = false;
      schedule();
    }
  }
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void restart(), 700);
}
function stop(code) {
  clearTimeout(timer);
  watcher?.close();
  stopping ??= Promise.allSettled([...children].map((child) => child.stop(25_000))).then(
    (results) => {
      process.exitCode = results.some((result) => result.status === "rejected") ? 1 : code;
    },
  );
  return stopping;
}
process.once("SIGINT", () => void stop(130));
process.once("SIGTERM", () => void stop(143));
try {
  const vite = await launch([
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ]);
  const deadline = Date.now() + 20_000;
  while (true) {
    try {
      if ((await fetch(env.CODE60_DEV_ASSETS, { signal: AbortSignal.timeout(1000) })).ok) break;
    } catch {}
    if (Date.now() > deadline) throw new Error("Vite did not become ready.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  let ready;
  let timeout;
  const compiled = new Promise((resolve, reject) => {
    ready = resolve;
    timeout = setTimeout(
      () => reject(new Error("Watch compilation did not become ready.")),
      20_000,
    );
  });
  void compiled.catch(() => {});
  let compiler;
  try {
    let output = "";
    compiler = await launch(
      ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json", "--watch"],
      (chunk) => {
        output = (output + chunk.toString()).slice(-4096);
        if (/Found 0 errors\. Watching for file changes\./.test(output)) ready();
      },
    );
    await compiled;
  } finally {
    clearTimeout(timeout);
  }
  if (!stopping) {
    watcher = watch(new URL("../dist", import.meta.url), { recursive: true }, schedule);
    watcher.on("error", () => void stop(1));
    await restart();
    for (const child of [vite, compiler])
      child.exited.then(() => {
        if (!stopping) void stop(1);
      });
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  await stop(1);
}
