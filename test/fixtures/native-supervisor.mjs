#!/usr/bin/env node
// Native supervisor boundary for isolated Linux desktop journeys only.
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { appendFile, lstat, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.CODE60_TEST_SUPERVISOR_ROOT;
const entry = process.env.CODE60_TEST_SERVICE_ENTRY;
if (!root || !entry || process.platform !== "linux") process.exit(2);
const args = process.argv.slice(2);
await appendFile(join(root, "supervisor-commands.jsonl"), `${JSON.stringify(args)}\n`);
if (await lstat(join(root, "supervisor-unavailable")).catch(() => null)) process.exit(1);
const pidFile = join(root, "supervisor-pid");
const pid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
const alive = (id) => {
  if (!id) return false;
  try {
    process.kill(id, 0);
    return true;
  } catch {
    return false;
  }
};
const wait = async (condition) => {
  const deadline = Date.now() + 8000;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error("Owned service did not settle");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
const action = args[1];
if (args[0] !== "--user") process.exit(2);
if (action === "show") {
  const installed = await lstat(
    join(process.env.HOME, ".config/systemd/user/code60-scheduler.service"),
  ).catch(() => null);
  process.stdout.write(
    `LoadState=${installed ? "loaded" : "not-found"}\nActiveState=${alive(pid) ? "active" : "inactive"}\n`,
  );
} else if (action === "daemon-reload") {
  // No OS manager is contacted.
} else if (action === "start" || action === "enable") {
  if (!alive(pid)) {
    const fd = openSync(join(root, "owned-service.log"), "a", 0o600);
    const child = spawn(process.execPath, [entry], {
      detached: true,
      stdio: ["ignore", fd, fd],
      env: process.env,
    });
    closeSync(fd);
    child.on("error", () => {
      process.exitCode = 1;
    });
    if (!child.pid) throw new Error("Missing service PID");
    await writeFile(pidFile, String(child.pid));
    child.unref();
    const { automationClient } = await import(pathToFileURL(join(entry, "..", "index.js")).href);
    await wait(
      async () => !!(await automationClient(process.env)({ action: "status" }).catch(() => null)),
    );
  }
} else if (action === "stop" || action === "disable") {
  if (alive(pid)) {
    process.kill(pid, "SIGTERM");
    await wait(() => !alive(pid));
  }
  await unlink(pidFile).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
} else process.exit(2);
