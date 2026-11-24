import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

export const prefix = "/installation/product";
const layout = JSON.parse(await readFile("/harness/layout.json", "utf8"));
export const application = layout.application;
export const fakeAgent = layout.fakeAgent;
export const launcher = layout.launcher;
export const updated = layout.update === true;
export const uninstall = layout.uninstall === true;
export const setupDatabase = layout.setupDatabase;
export const execute = promisify(execFile);

export function architecture(expected = "x64") {
  assert.equal(process.platform, "linux", "Acceptance requires Linux");
  assert.equal(process.arch, expected, "Acceptance runtime architecture mismatch");
  assert.notEqual(process.getuid(), 0, "Acceptance must be non-root");
}

export function environment(home) {
  return {
    PATH: `${prefix}/node_modules/.bin:/harness/bin:/usr/local/bin:/usr/bin:/bin`,
    HOME: home,
    SHELL: "/bin/sh",
    XDG_CONFIG_HOME: `${home}/config`,
    XDG_STATE_HOME: `${home}/state`,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    NPM_CONFIG_USERCONFIG: "/dev/null",
    NPM_CONFIG_GLOBALCONFIG: `${home}/empty-global-npmrc`,
    NPM_CONFIG_CACHE: `${home}/npm-cache`,
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
  };
}

export async function evidence(name, value) {
  const scenario = process.env.ACCEPTANCE_CASE ?? "baseline";
  assert.ok(["baseline", "assets", "model"].includes(scenario));
  await writeFile(
    `/evidence/${name}${scenario === "baseline" ? "" : `-${scenario}`}.json`,
    `${JSON.stringify(value, null, 2)}\n`,
    { mode: 0o600 },
  );
}

export async function waitFor(check, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (true) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error("Acceptance checkpoint timed out");
    await delay(100);
  }
}

export async function publicConnection() {
  const saved = JSON.parse(
    await readFile("/work/home/state/code60/gateway/connection.json", "utf8"),
  );
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(saved.origin);
  assert.ok(match && Number(match[1]) <= 65535, "Invalid loopback origin");
  assert.ok(Number.isInteger(saved.pid) && saved.pid > 1);
  return { origin: `http://127.0.0.1:${Number(match[1])}`, pid: saved.pid, port: Number(match[1]) };
}

export async function processes(excluded) {
  const found = [];
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/.test(name) || excluded.has(Number(name))) continue;
    const stat = await readFile(`/proc/${name}/stat`, "utf8").catch(() => null);
    if (stat)
      found.push({
        pid: Number(name),
        state: stat.slice(stat.lastIndexOf(") ") + 2).split(" ")[0],
      });
  }
  return found;
}

export async function fresh(home) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  assert.deepEqual(await readdir(home), [], "Customer HOME must start empty");
  return environment(home);
}

export async function cli(args, env) {
  return execute(
    launcher ?? process.execPath,
    launcher ? args : [join(application, "dist/management/main.js"), ...args],
    {
      env,
      cwd: "/work",
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
}
