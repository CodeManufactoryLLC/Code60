import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, open, stat, writeFile } from "node:fs/promises";
import {
  application,
  architecture,
  evidence,
  fresh,
  publicConnection,
  waitFor,
} from "./support.mjs";

process.umask(0o077);
architecture();
const env = await fresh("/work/home");
await mkdir("/work/control", { recursive: true });
await mkdir("/work/processes");
await mkdir("/work/driver-home", { mode: 0o700 });
await mkdir(`${env.XDG_CONFIG_HOME}/code60`, { recursive: true });
await writeFile(
  `${env.XDG_CONFIG_HOME}/code60/config.json`,
  JSON.stringify({
    agents: {
      claude: {
        command: [
          process.execPath,
          "/installation/product/fixtures/fake-agent.mjs",
          "--relay",
          "--session-info",
          "--process-log",
          "/work/processes",
        ],
      },
    },
  }),
);
const log = await open("/evidence/backend.log", "a", 0o600);
const child = spawn(process.execPath, [`${application}/dist/gateway/main.js`], {
  cwd: "/work",
  env,
  detached: true,
  stdio: ["ignore", log.fd, log.fd],
});
await log.close();
let exit;
const exited = new Promise((ready, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    exit = { code, signal };
    ready();
  });
});
void exited.catch(() => {});
let stopping;
async function stop() {
  stopping ??= (async () => {
    if (!exit) child.kill("SIGTERM");
    let timer;
    try {
      await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Installed backend did not stop")), 25_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    assert.equal(exit.code, 0, "Installed backend shutdown failed");
    await writeFile(
      "/work/control/stopped.json",
      JSON.stringify({ stopped: true, runtime: process.pid }),
    );
    await evidence("shutdown", { backendExited: true, code: exit.code });
  })();
  return stopping;
}
const poll = setInterval(() => {
  void stat("/work/control/stop")
    .then(() => stop())
    .catch((error) => {
      if (error.code !== "ENOENT") {
        console.error(error.message);
        process.exitCode = 1;
        clearInterval(poll);
      }
    });
}, 100);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    clearInterval(poll);
    void stop().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  });
try {
  const connection = await waitFor(async () => {
    if (exit) throw new Error("Installed backend exited before readiness");
    return publicConnection().catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
  });
  await writeFile(
    "/work/control/public.json",
    JSON.stringify({ ...connection, runtime: process.pid }),
  );
  await evidence("runtime", {
    platform: process.platform,
    architecture: process.arch,
    uid: process.getuid(),
    entrypoint: `${application}/dist/gateway/main.js`,
    origin: connection.origin,
    backendPid: connection.pid,
    supervisorPid: process.pid,
    emptyHomeBeforeFixture: true,
    externalNetworking: "disabled",
  });
} catch (error) {
  clearInterval(poll);
  await stop().catch(() => {});
  throw error;
}
