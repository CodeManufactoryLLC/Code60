import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const { gatewaySupervisor } = await import(
  new URL("./gateway-supervisor.mjs", import.meta.url).href
);

import {
  application,
  environment,
  evidence,
  execute,
  fakeAgent,
  launcher,
  publicConnection,
  setupDatabase,
  updated,
} from "./support.mjs";

process.umask(0o077);
const env = { ...environment("/work/home"), SHELL: "/bin/bash", XDG_DATA_HOME: "/installation" };
await mkdir("/work/control", { recursive: true });
await mkdir("/work/processes");
await mkdir("/work/driver-home", { mode: 0o700 });
const selection = `${env.XDG_STATE_HOME}/code60/desktop.json`,
  database = setupDatabase ?? "/installation/code60/databases/default.sqlite";
if (!updated) {
  await assert.rejects(readdir(`${env.XDG_STATE_HOME}/code60`), { code: "ENOENT" });
  await assert.rejects(readdir("/installation/code60/databases"), { code: "ENOENT" });
} else {
  assert.equal(JSON.parse(await readFile(selection, "utf8")).database, database);
}
await mkdir(`${env.XDG_CONFIG_HOME}/code60`, { recursive: true });
await writeFile(
  `${env.XDG_CONFIG_HOME}/code60/config.json`,
  JSON.stringify({
    agents: {
      claude: {
        command: [
          process.execPath,
          fakeAgent,
          "--relay",
          "--session-info",
          "--process-log",
          "/work/processes",
        ],
      },
    },
  }),
);
const supervisor = await gatewaySupervisor({
  directory: "/work",
  application,
  env,
  log: "/evidence/gateway.log",
});
env.CODE60_TEST_GATEWAY_SOCKET = supervisor.socket;
let stopping;
async function stop() {
  stopping ??= (async () => {
    await supervisor.close();
    await writeFile(
      "/work/control/stopped.json",
      JSON.stringify({ stopped: true, runtime: process.pid }),
    );
    await evidence("shutdown", { gatewayExited: true, code: 0 });
  })();
  return stopping;
}
let polling;
try {
  if (updated) {
    await execute(launcher, ["setup", "--yes", "--no-open"], { env, cwd: "/", timeout: 45000 });
  } else {
    const { bootstrapMain } = await import(
      pathToFileURL("/work/bootstrap-cache/bin/code60.mjs").href
    );
    assert.equal(
      await bootstrapMain(["setup", "--yes", "--no-open"], {
        env,
        acquisition: {
          transport: () => {
            throw Error("Healthy setup unexpectedly downloaded");
          },
        },
      }),
      0,
    );
    await rm("/work/bootstrap-cache", { recursive: true });
  }
  await assert.rejects(stat("/work/bootstrap-cache"), { code: "ENOENT" });
  const prefs = JSON.parse(await readFile(selection, "utf8"));
  assert.equal(prefs.database, database);
  assert.equal(prefs.agentSetup, undefined);
  const connection = await publicConnection();
  const status = JSON.parse(
    (await execute(launcher, ["status"], { env, cwd: "/", timeout: 15000 })).stdout,
  );
  assert.equal(status.database.state, "ready");
  assert.equal(status.gateway.available, true);
  const before = await readFile(database);
  await execute(launcher, ["setup", "--yes", "--no-open"], { env, cwd: "/", timeout: 45000 });
  assert.equal(supervisor.pid(), connection.pid);
  assert.deepEqual(await readFile(database), before);
  for (const mode of ["on", "off"])
    await execute(launcher, ["pairing", mode, "--yes"], { env, cwd: "/", timeout: 15000 });
  await writeFile(
    "/work/control/public.json",
    JSON.stringify({ ...connection, runtime: process.pid, setupDatabase: database }),
  );
  await evidence("setup", {
    complete: true,
    bootstrapCacheRemoved: true,
    repeatedWithoutRestart: true,
    noProviderVerification: true,
    database,
    readOnlyInstalledTrees: true,
    updated,
    nativeService: "bounded fixture only",
  });
  await evidence("runtime", {
    platform: process.platform,
    architecture: process.arch,
    uid: process.getuid(),
    entrypoint: `${application}/dist/gateway/main.js`,
    origin: connection.origin,
    gatewayPid: connection.pid,
    supervisorPid: process.pid,
    emptyStateBeforeSetup: !updated,
    preservedUpdateState: updated,
    externalNetworking: "disabled",
  });
  polling = setInterval(() => {
    void stat("/work/control/stop")
      .then(() => stop())
      .catch((error) => {
        if (error.code !== "ENOENT") {
          console.error(error.message);
          process.exitCode = 1;
          clearInterval(polling);
        }
      });
  }, 100);
  for (const name of ["SIGINT", "SIGTERM"])
    process.once(name, () => {
      clearInterval(polling);
      void stop().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
    });
} catch (error) {
  clearInterval(polling);
  await supervisor.close().catch(() => {});
  throw error;
}
