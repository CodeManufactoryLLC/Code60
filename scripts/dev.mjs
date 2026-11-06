import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";
import electron from "electron";

const root = fileURLToPath(new URL("..", import.meta.url));
const children = new Set();
let stopping = false;
let app;
let timer;
let restarting = false;
let dirty = false;
function launch(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: "inherit" });
  children.add(child);
  child.once("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.once("exit", () => children.delete(child));
  return child;
}
function startApp() {
  app = launch(electron, ["."]);
  app.once("exit", (code) => {
    if (!restarting && !stopping) stop(code ?? 0);
  });
}
function restart() {
  if (stopping) return;
  if (restarting) {
    dirty = true;
    return;
  }
  restarting = true;
  app.once("exit", () => {
    restarting = false;
    if (!stopping) {
      startApp();
      if (dirty) {
        dirty = false;
        schedule();
      }
    }
  });
  app.kill("SIGTERM");
}
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(restart, 700);
}
let watcher;
function stop(code) {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  watcher?.close();
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(130));
const build = launch("npm", ["run", "build"]);
build.once("exit", (code) => {
  if (code !== 0 || stopping) {
    stop(code ?? 1);
    return;
  }
  startApp();
  // Production-file loading also in development keeps renderer privileges identical.
  watcher = watch(new URL("../dist", import.meta.url), { recursive: true }, schedule);
  const compiler = launch(process.execPath, [
    "node_modules/typescript/bin/tsc",
    "-p",
    "tsconfig.build.json",
    "--watch",
  ]);
  const renderer = launch(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--watch"]);
  for (const child of [compiler, renderer])
    child.once("exit", (result) => {
      if (!stopping) stop(result ?? 1);
    });
});
