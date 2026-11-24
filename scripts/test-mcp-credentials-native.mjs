import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

class NativeBlocked extends Error {}

const here = fileURLToPath(import.meta.url);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(check, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error("Native readiness/cleanup deadline exceeded");
    await delay(25);
  }
}
function control(args) {
  try {
    return execFileSync("gdbus", ["call", "--session", ...args], {
      encoding: "utf8",
      timeout: 2000,
      maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Private Secret Service control failed");
  }
}
const bus = (method, ...args) =>
  control([
    "--dest",
    "org.freedesktop.DBus",
    "--object-path",
    "/org/freedesktop/DBus",
    "--method",
    `org.freedesktop.DBus.${method}`,
    ...args,
  ]);
const service = (method, ...args) =>
  control([
    "--dest",
    "org.freedesktop.secrets",
    "--object-path",
    "/org/freedesktop/secrets",
    "--method",
    `org.freedesktop.Secret.Service.${method}`,
    ...args,
  ]);
const property = (path, name) =>
  control([
    "--dest",
    "org.freedesktop.secrets",
    "--object-path",
    path,
    "--method",
    "org.freedesktop.DBus.Properties.Get",
    "org.freedesktop.Secret.Collection",
    name,
  ]);
async function filesFree(directory, secrets) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) await filesFree(path, secrets);
    else if (item.isFile()) {
      const data = await readFile(path);
      for (const secret of secrets)
        assert.ok(
          !data.includes(Buffer.from(secret)),
          "Native secret appeared in a plaintext file",
        );
    }
  }
}
async function checkStore(packageRoot, env, evidence, linux) {
  const { nativeCredentialStore } = await import(
    pathToFileURL(join(packageRoot, "dist/platform/index.js")).href
  );
  // Keychain locates the login user's store through HOME. Only this bounded helper
  // uses the real login home; installation and file oracles remain isolated, and
  // every native operation is limited to the unique service/account below.
  const credential = nativeCredentialStore(linux ? env : { ...env, HOME: process.env.HOME });
  const serviceName = `code60.mcp.${randomUUID()}`,
    account = createHash("sha256").update(randomUUID()).digest("hex");
  const address = { service: serviceName, account };
  const secret = `synthetic-${randomUUID()}`;
  const result = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    service: serviceName,
    account,
    status: "FAIL",
    roundTrip: false,
    locked: false,
    unavailable: false,
    deleted: false,
    cleanup: false,
  };
  await writeFile(
    join(evidence, "native-ownership.json"),
    `${JSON.stringify({ pid: process.pid, ...address, linuxPrivateBus: linux })}\n`,
    { mode: 0o600 },
  );
  let daemon,
    daemonExit,
    collection,
    attempted = false;
  const login = `synthetic-login-${randomUUID()}`;
  const controlDirectory = join(env.HOME, "control");
  env = { ...env, GNOME_KEYRING_CONTROL: controlDirectory };
  const startDaemon = async () => {
    daemon = spawn(
      "gnome-keyring-daemon",
      ["--foreground", "--unlock", "--components=secrets", "--control-directory", controlDirectory],
      { env, stdio: ["pipe", "ignore", "ignore"] },
    );
    daemonExit = new Promise((done) => {
      daemon.once("error", done);
      daemon.once("exit", done);
    });
    daemon.stdin.on("error", () => {});
    daemon.stdin.end(login);
    result.daemonPid = daemon.pid;
    await until(() => bus("NameHasOwner", "org.freedesktop.secrets").includes("true"));
  };
  const stopDaemon = async () => {
    if (!daemon) return;
    if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill("SIGTERM");
    await Promise.race([
      daemonExit,
      delay(5000).then(() => {
        throw new Error("Private Secret Service cleanup unresolved");
      }),
    ]);
    await until(() => !bus("NameHasOwner", "org.freedesktop.secrets").includes("true"));
  };
  const unlock = async () => {
    await stopDaemon();
    await startDaemon();
  };
  try {
    if (linux) {
      await mkdir(controlDirectory, { recursive: true, mode: 0o700 });
      await startDaemon();
    }
    const absent = await credential({ action: "get", ...address });
    if (absent.status !== "available")
      throw new NativeBlocked(`Native secure store is ${absent.status}`);
    assert.ok(absent.secret === null, "Synthetic namespace was not empty");
    attempted = true;
    const written = await credential({ action: "set", ...address, secret });
    if (written.status !== "available")
      throw new NativeBlocked(`Native secure store is ${written.status}`);
    const read = await credential({ action: "get", ...address });
    assert.ok(
      read.status === "available" && read.secret === secret,
      "Native credential round-trip failed",
    );
    result.roundTrip = true;
    if (linux) {
      const alias = service("ReadAlias", "default");
      collection = /objectpath '([^']+)'/.exec(alias)?.[1];
      assert.ok(
        collection?.startsWith("/org/freedesktop/secrets/collection/"),
        "Private default collection unavailable",
      );
      assert.match(property(collection, "Items"), /objectpath/);
      service("Lock", JSON.stringify([collection]));
      await until(() => property(collection, "Locked").includes("true"));
      const locked = await credential({ action: "get", ...address }, AbortSignal.timeout(5000));
      assert.equal(locked.status, "locked", "Locked Secret Service must remain visible");
      const blockedDelete = await credential(
        { action: "delete", ...address },
        AbortSignal.timeout(5000),
      );
      assert.equal(blockedDelete.status, "locked", "Locked deletion must not claim absence");
      result.locked = true;
      await unlock();
      await until(() => property(collection, "Locked").includes("false"));
      const retained = await credential({ action: "get", ...address });
      assert.ok(
        retained.status === "available" && retained.secret === secret,
        "Failed locked deletion lost or hid the owned entry",
      );
      const unavailable = nativeCredentialStore({
        ...env,
        DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(env.HOME, "no-service")}`,
      });
      const missing = await unavailable({ action: "get", ...address });
      assert.equal(
        missing.status,
        "unavailable",
        "Secret Service absence must not fall back to keyutils",
      );
      await unavailable.close();
      result.unavailable = true;
    }
    if (!linux) {
      const unavailable = nativeCredentialStore(env);
      try {
        const missingDefault = await unavailable({ action: "get", ...address });
        assert.equal(
          missingDefault.status,
          "unavailable",
          "An absent isolated default Keychain must remain visible",
        );
        result.unavailable = true;
      } finally {
        await unavailable.close();
      }
    }
    const deleted = await credential({ action: "delete", ...address });
    assert.equal(deleted.status, "available");
    const gone = await credential({ action: "get", ...address });
    assert.ok(
      gone.status === "available" && gone.secret === null,
      "Native deletion did not remove the owned entry",
    );
    result.deleted = true;
    if (linux) assert.match(property(collection, "Items"), /\[\]/);
    else {
      let absent = false;
      try {
        execFileSync("security", ["find-generic-password", "-s", serviceName, "-a", account], {
          stdio: "ignore",
          timeout: 5000,
        });
      } catch (error) {
        absent = error.status === 44;
      }
      assert.ok(absent, "Independent Keychain lookup did not prove owned-entry absence");
    }
    for (const directory of [env.HOME, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME])
      await filesFree(directory, [secret, login]);
    result.status = "PASS";
  } catch (error) {
    result.status = error instanceof NativeBlocked ? "BLOCKED" : "FAIL";
    result.failure = error instanceof Error ? error.message : "Native validation failed";
  } finally {
    const cleanupErrors = [];
    try {
      if (!result.deleted && attempted) {
        if (linux && collection && property(collection, "Locked").includes("true")) await unlock();
        const removal = await credential({ action: "delete", ...address });
        result.deleted = removal.status === "available";
      }
    } catch {
      cleanupErrors.push("Owned-entry removal failed");
    }
    try {
      await credential.close();
    } catch {
      cleanupErrors.push("Native helper cleanup failed");
    }
    try {
      if (daemon) {
        await stopDaemon();
      }
    } catch {
      cleanupErrors.push("Private Secret Service cleanup failed");
    }
    result.cleanup = (!attempted || result.deleted) && cleanupErrors.length === 0;
    result.cleanupErrors = cleanupErrors;
    await writeFile(join(evidence, "native-result.json"), `${JSON.stringify(result)}\n`, {
      mode: 0o600,
    });
  }
  assert.equal(
    result.status,
    "PASS",
    "Native credential check failed or is blocked; inspect typed evidence",
  );
  assert.ok(result.cleanup);
}

if (process.argv[2] === "--session") {
  const [root, packageRoot, evidence] = process.argv.slice(3);
  await checkStore(packageRoot, process.env, evidence, true);
} else {
  assert.ok(["linux", "darwin"].includes(process.platform));
  assert.match(process.version, /^v24\./);
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.dependencies["@napi-rs/keyring"], "2.1.2");
  const development = process.argv[2] === "--development";
  const archive = resolve(
    development
      ? "package.json"
      : (process.argv[2] ?? `release/build/code60-${manifest.version}.tgz`),
  );
  await stat(archive);
  const evidence = resolve(
    process.env.CODE60_NATIVE_EVIDENCE ?? "test-results/qa/mcp-credentials-native",
  );
  await mkdir(evidence, { recursive: true });
  const root = await mkdtemp(join(tmpdir(), "code60-mcp-credentials-native-"));
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_RUNTIME_DIR: join(root, "runtime"),
    TMPDIR: root,
    LANG: "C.UTF-8",
    CI: "1",
    npm_config_userconfig: "/dev/null",
    npm_config_cache: join(evidence, "npm-cache"),
  };
  for (const directory of [
    env.HOME,
    env.XDG_CONFIG_HOME,
    env.XDG_DATA_HOME,
    env.XDG_STATE_HOME,
    env.XDG_RUNTIME_DIR,
  ])
    await mkdir(directory, { mode: 0o700 });
  let owned,
    clean = false;
  try {
    if (!development) {
      const output = execFileSync(
        "npm",
        [
          "install",
          "--prefix",
          root,
          "--omit=dev",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          archive,
        ],
        { env, encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
      );
      await writeFile(join(evidence, "install.log"), output);
    }
    const packageRoot = development ? resolve(".") : join(root, "node_modules/code60");
    await stat(join(packageRoot, "dist/platform/credential-helper.js"));
    if (process.platform === "linux") {
      const { spawnOwnedProcess } = await import(
        pathToFileURL(join(packageRoot, "dist/platform/index.js")).href
      );
      owned = await spawnOwnedProcess(
        [
          "dbus-run-session",
          "--",
          process.execPath,
          here,
          "--session",
          root,
          packageRoot,
          evidence,
        ],
        root,
        env,
      );
      owned.stdout.resume();
      let diagnostics = "";
      owned.stderr.on("data", (chunk) => {
        if (diagnostics.length < 32768)
          diagnostics += chunk.toString("utf8").slice(0, 32768 - diagnostics.length);
      });
      let timer;
      let exit;
      try {
        exit = await Promise.race([
          owned.exited,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("Native session deadline exceeded")), 90_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      await owned.stop(100);
      await writeFile(
        join(evidence, "session.stderr.log"),
        diagnostics.replace(/synthetic-(?:login-)?[a-f0-9-]{36}/g, "[synthetic secret redacted]"),
        { mode: 0o600 },
      );
      assert.equal(
        exit.code,
        0,
        "Disposable native Secret Service check failed; inspect typed evidence",
      );
      assert.throws(() => process.kill(-owned.pid, 0));
    } else await checkStore(packageRoot, env, evidence, false);
    clean = true;
  } finally {
    await owned?.stop(100);
    await writeFile(
      join(evidence, "ownership.json"),
      `${JSON.stringify({ root, archive, mode: development ? "development" : "installed-tarball", pid: owned?.pid, cleanup: clean })}\n`,
      { mode: 0o600 },
    );
    if (clean) await rm(root, { recursive: true, force: true });
  }
  assert.ok(clean);
  process.stdout.write(
    "Native MCP credential helper: isolated secure storage, owned-entry round-trip/deletion and cleanup passed. No unrelated credentials were enumerated.\n",
  );
}
