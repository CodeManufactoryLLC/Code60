// Real installed CLI acceptance. Only the caller's bounded native supervisor is fake.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const absent = async (path) => {
  await assert.rejects(lstat(path), { code: "ENOENT" });
};
async function tree(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) return { link: await readlink(path) };
  if (info.isFile()) return { hash: digest(await readFile(path)), mode: info.mode & 0o777 };
  assert.ok(info.isDirectory(), "Unexpected fixture filesystem entry");
  const entries = {};
  for (const name of (await readdir(path)).sort()) entries[name] = await tree(join(path, name));
  return entries;
}
function databaseSnapshot(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("BEGIN");
    const schema = db
      .prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY name")
      .all();
    const tables = {};
    for (const { name } of schema.filter((entry) => entry.type === "table")) {
      const rows = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all();
      tables[name] = {
        rows: rows.length,
        hash: digest(
          rows
            .map((row) => JSON.stringify(row))
            .sort()
            .join("\n"),
        ),
      };
    }
    return { schema: digest(JSON.stringify(schema)), tables };
  } finally {
    db.close();
  }
}
async function exited(pid, signal) {
  const deadline = Date.now() + 10000;
  for (;;) {
    signal.throwIfAborted();
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    assert.ok(Date.now() < deadline, "Original owned process remained after uninstall");
    await delay(50, undefined, { signal });
  }
}

export async function uninstallJourney({
  root,
  application,
  launcher,
  env,
  selection,
  database,
  project,
  processLog,
  promptLog,
  connection,
  install,
  output,
  signal,
}) {
  const command = (file, args, timeout = 8 * 60_000) =>
    execute(file, args, {
      env,
      cwd: "/",
      signal,
      timeout,
      maxBuffer: 2 * 1024 ** 2,
    });
  const cli = (args) => command(launcher, args);
  const original = await connection();
  assert.ok(Number.isSafeInteger(original.pid) && original.pid > 1);
  const current = await readlink(join(root, "current"));
  const preserved = async () => ({
    selection: digest(await readFile(selection)),
    configuration: digest(await readFile(join(env.XDG_CONFIG_HOME, "code60/config.json"))),
    database: databaseSnapshot(database),
    project: await tree(project),
    worktrees: await tree(`${project}.worktrees`),
    profiles: await Promise.all(
      [".bash_profile", ".bashrc", ".zprofile", ".zshrc"].map(async (name) => ({
        name,
        hash: await readFile(join(env.HOME, name))
          .then(digest)
          .catch((error) => {
            if (error.code !== "ENOENT") throw error;
            return null;
          }),
      })),
    ),
    prompts: (await readdir(promptLog)).sort(),
    engines: await Promise.all(
      ["0.1.0-staging.18", "0.1.0-staging.20"].map(async (version) => ({
        version,
        hash: await readFile(join(root, "engines", `${version}.json`))
          .then(digest)
          .catch((error) => {
            if (error.code !== "ENOENT") throw error;
            return null;
          }),
      })),
    ),
  });
  const before = await preserved();
  assert.ok(before.prompts.length > 0, "Golden-journey dispatch evidence missing");
  await writeFile(
    join(output, "uninstall-before.json"),
    JSON.stringify({ original, current, state: before }, null, 2),
    { mode: 0o600 },
  );
  console.log("Installed uninstall: inspect consent and unexpected-file refusal");
  await assert.rejects(cli(["uninstall", "--purge"]), /Use code60 uninstall/);
  await assert.rejects(cli(["uninstall"]), /requires explicit consent/);
  assert.equal((await connection()).pid, original.pid);
  assert.equal(await readlink(join(root, "current")), current);
  assert.deepEqual(await preserved(), before);

  // New contents are never adopted merely because they are beneath a release.
  const foreign = join(application, "unowned-uninstall-fixture");
  await writeFile(foreign, "preserve unexpected contents", { flag: "wx", mode: 0o600 });
  try {
    await assert.rejects(cli(["uninstall", "--yes"]), /unowned|unexpected|undeclared|inventory/i);
    assert.equal((await connection()).pid, original.pid);
    assert.equal(await readFile(foreign, "utf8"), "preserve unexpected contents");
  } finally {
    await unlink(foreign);
  }
  console.log("Installed uninstall: consented removal and original process exit");
  const removed = await cli(["uninstall", "--yes"]);
  await writeFile(join(output, "uninstall.log"), `${removed.stdout}${removed.stderr}`, {
    mode: 0o600,
  });
  await exited(original.pid, signal);
  const providers = [];
  for (const name of await readdir(processLog)) {
    const value = JSON.parse(await readFile(join(processLog, name), "utf8"));
    assert.ok(Number.isSafeInteger(value.pid) && value.pid > 0);
    await exited(value.pid, signal);
    providers.push({ pid: value.pid, exited: true });
  }
  assert.ok(providers.length > 0, "Golden-journey provider process evidence missing");
  await absent(launcher);
  await absent(join(root, "current"));
  await absent(application);
  await absent(join(root, current));
  const progress = JSON.parse(await readFile(join(root, "removal.json"), "utf8"));
  assert.equal(progress.phase, "complete");
  assert.match(progress.attempt, /^[a-f0-9-]{36}$/);
  const recovery = join(root, "removals", progress.attempt, "code60");
  const receiptText = await readFile(
    join(root, "removals", progress.attempt, "receipt.json"),
    "utf8",
  );
  assert.equal(digest(receiptText), progress.receiptHash);
  const receipt = JSON.parse(receiptText);
  await writeFile(
    join(output, "verified-removal-inventories.json"),
    JSON.stringify(
      {
        receiptSha256: progress.receiptHash,
        attempt: progress.attempt,
        installationId: receipt.installation.id,
        generation: receipt.generation,
        current: receipt.current,
        launcher: receipt.launcher,
        node: receipt.node,
        inventories: receipt.inventories,
        engineVersions: receipt.engines.map((engine) => engine.version),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  for (const inventory of receipt.inventories) {
    assert.ok(
      inventory.root.startsWith(`${root}/releases/`) ||
        inventory.root.startsWith(`${root}/activations/`),
    );
    await absent(inventory.root);
  }
  const registration = JSON.parse(
    await readFile(join(env.XDG_STATE_HOME, "code60/gateway/registration.json"), "utf8"),
  );
  assert.equal(registration.installed, false);
  await absent(
    process.platform === "darwin"
      ? join(env.HOME, "Library/LaunchAgents/com.codemanufactory.code60.backend.plist")
      : join(env.HOME, ".config/systemd/user/code60-backend.service"),
  );
  assert.deepEqual(await preserved(), before);
  await command(recovery, ["uninstall", "--yes"]);
  assert.deepEqual(await preserved(), before);

  console.log("Installed uninstall: retained-data reinstall and stale recovery refusal");
  const installed = await install();
  assert.equal(installed.release, application);
  assert.notEqual(await readlink(join(root, "current")), current);
  const setup = await cli(["setup", "--yes", "--no-open"]);
  await writeFile(join(output, "reinstall-setup.log"), `${setup.stdout}${setup.stderr}`, {
    mode: 0o600,
  });
  const restarted = await connection();
  assert.notEqual(restarted.pid, original.pid);
  const status = JSON.parse((await cli(["status"])).stdout);
  assert.equal(status.backend.available, true);
  assert.equal(status.database.state, "ready");
  assert.deepEqual(await preserved(), before);
  await assert.rejects(command(recovery, ["uninstall", "--yes"]), /later|new|activation|current/i);
  assert.equal((await connection()).pid, restarted.pid);
  const result = {
    status: "PASS",
    originalPid: original.pid,
    newPid: restarted.pid,
    providers,
    unsupportedArgumentsRejected: true,
    nonTtyConsentRefused: true,
    unexpectedFilePreservedBeforeQuiescence: true,
    priorActivationRemoved: current,
    repeatedRecovery: true,
    oldRecoveryRefusedAfterReinstall: true,
    original: before,
    retained: await preserved(),
    nativeService: "bounded test-only supervisor; no native login/reboot claim",
  };
  await writeFile(join(output, "uninstall-reinstall.json"), JSON.stringify(result, null, 2), {
    mode: 0o600,
  });
  return { ...restarted, result };
}
