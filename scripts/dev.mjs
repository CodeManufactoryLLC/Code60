import { execFileSync } from "node:child_process";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";
import electron from "electron";

const root = fileURLToPath(new URL("..", import.meta.url));
// Bootstrap only the first-party compiler and helper, with finite deadlines.
// Once compiled, all long-lived development processes use the production owner.
for (const args of [
  ["scripts/build-windows-helper.mjs"],
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"],
])
  execFileSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
    timeout: 120_000,
  });
const { spawnOwnedProcess } = await import("../dist/platform/index.js");
const children = new Set();
const restartingApps = new WeakSet();
let stopping;
let app;
let timer;
let watcher;
let restarting = false;
let dirty = false;
const appGrace = process.platform === "win32" ? 0 : 25_000;

async function launch(command, args) {
  const child = await spawnOwnedProcess([command, ...args], root);
  if (stopping) {
    await child.stop(0);
    throw new Error("Development startup cancelled");
  }
  children.add(child);
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.pipe(process.stderr, { end: false });
  child.exited
    .then(() => {
      children.delete(child);
      return child.stop(0);
    })
    .catch((error) => {
      console.error(error.message);
      void stop(1);
    });
  return child;
}
async function startApp() {
  const child = await launch(electron, ["."]);
  app = child;
  child.exited.then(({ code }) => {
    if (!restartingApps.has(child) && !stopping) void stop(code ?? 0);
  });
}
async function restart() {
  if (stopping) return;
  if (restarting) {
    dirty = true;
    return;
  }
  restarting = true;
  try {
    restartingApps.add(app);
    await app.stop(appGrace);
    if (!stopping) await startApp();
  } catch (error) {
    console.error(error.message);
    void stop(1);
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
  if (stopping) {
    for (const child of children) void child.stop(0).catch(() => {});
    return stopping;
  }
  stopping = Promise.allSettled(
    [...children].map((child) => child.stop(child === app ? appGrace : 5_000)),
  ).then((results) => {
    process.exitCode = results.some((result) => result.status === "rejected") ? 1 : code;
  });
  return stopping;
}
process.on("SIGINT", () => void stop(130));
process.on("SIGTERM", () => void stop(130));
try {
  const build = await launch(process.execPath, ["node_modules/vite/bin/vite.js", "build"]);
  if ((await build.exited).code !== 0) await stop(1);
  else {
    await startApp();
    watcher = watch(new URL("../dist", import.meta.url), { recursive: true }, schedule);
    watcher.on("error", (error) => {
      console.error(error.message);
      void stop(1);
    });
    for (const args of [
      ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json", "--watch"],
      ["node_modules/vite/bin/vite.js", "build", "--watch"],
    ]) {
      const child = await launch(process.execPath, args);
      child.exited.then(({ code }) => {
        if (!stopping) void stop(code ?? 1);
      });
    }
  }
} catch (error) {
  console.error(error.message);
  await stop(1);
}
