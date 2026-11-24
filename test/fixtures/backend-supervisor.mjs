// Dedicated bounded backend fixture. Never contacts a native supervisor.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFile, lstat, mkdir, mkdtemp, open, readFile, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function backendSupervisor({
  directory,
  application,
  candidateApplication,
  env,
  log,
}) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const socketDirectory =
    Buffer.byteLength(join(directory, "backend-supervisor.sock")) > 90
      ? await mkdtemp("/tmp/code60-supervisor-")
      : directory;
  const socket = join(socketDirectory, "backend-supervisor.sock");
  let child, exited, stopping, closing;
  const calls = [];
  const stateRoot = join(env.XDG_STATE_HOME, "code60/gateway");
  const unit =
    process.platform === "darwin"
      ? join(env.HOME, "Library/LaunchAgents/com.codemanufactory.code60.backend.plist")
      : join(env.HOME, ".config/systemd/user/code60-backend.service");
  const label = `gui/${process.getuid()}/com.codemanufactory.code60.backend`;
  const alive = () => child && child.exitCode === null && child.signalCode === null;
  async function start() {
    if (alive()) return;
    const saved = JSON.parse(await readFile(join(stateRoot, "registration.json"), "utf8"));
    assert.equal(await realpath(saved.runtime.executable), await realpath(process.execPath));
    assert.equal(saved.runtime.args.length, 1);
    const selectedApplication = [
      application,
      ...(candidateApplication ? [candidateApplication] : []),
    ].find((value) => saved.runtime.args[0] === join(value, "dist/gateway/main.js"));
    assert.ok(
      selectedApplication,
      "Fixture refuses an application outside its two exact update identities",
    );
    for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_DATA_HOME"])
      assert.equal(saved.runtime.env[key], env[key]);
    if (env.CODEX_HOME) assert.equal(saved.runtime.env.CODEX_HOME, env.CODEX_HOME);
    const { userServiceDefinition, installationSnapshot } = await import(
      pathToFileURL(join(selectedApplication, "dist/platform/index.js")).href
    );
    const expected = userServiceDefinition(
      process.platform,
      env.HOME,
      stateRoot,
      saved.runtime,
      "backend",
    );
    assert.equal(expected.path, unit);
    const definition = await installationSnapshot(unit, 65536, true);
    assert.ok(definition);
    assert.equal(definition.identity.mode, 0o600);
    assert.equal(definition.text, expected.contents);
    const file = await open(log, "a", 0o600);
    child = spawn(saved.runtime.executable, saved.runtime.args, {
      env: { ...env, ...saved.runtime.env, CODE60_TEST_BACKEND_SOCKET: socket },
      cwd: directory,
      detached: true,
      stdio: ["ignore", file.fd, file.fd],
    });
    exited = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    void exited.catch(() => {});
    await file.close();
    stopping = undefined;
  }
  async function stop() {
    stopping ??= (async () => {
      if (!child) return;
      if (alive()) child.kill("SIGTERM");
      let timer;
      try {
        const result = await Promise.race([
          exited,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              if (alive()) child.kill("SIGKILL");
              reject(Error("Fixture backend shutdown timed out"));
            }, 25000);
          }),
        ]);
        assert.equal(result.code, 0);
      } finally {
        clearTimeout(timer);
      }
    })();
    return stopping;
  }
  const server = createServer(async (req, res) => {
    try {
      let text = "";
      for await (const part of req) {
        text += part;
        if (text.length > 4096) throw Error("Fixture request too large");
      }
      const { name, args } = JSON.parse(text);
      assert.ok(Array.isArray(args));
      calls.push({ name, args });
      await appendFile(join(directory, "supervisor.jsonl"), `${JSON.stringify({ name, args })}\n`, {
        mode: 0o600,
      });
      let stdout = "",
        ok = true;
      const action = args[1];
      if (name === "systemctl" && args[0] === "--user") {
        if (
          action === "show" &&
          ["code60-backend.service", "code60-scheduler.service"].includes(args[2]) &&
          JSON.stringify(args.slice(3)) ===
            JSON.stringify(["--property=LoadState", "--property=ActiveState", "--property=MainPID"])
        ) {
          const present =
            args[2] === "code60-backend.service" && !!(await lstat(unit).catch(() => null));
          stdout = `LoadState=${present ? "loaded" : "not-found"}\nActiveState=${present && alive() ? "active" : "inactive"}\nMainPID=${present && alive() ? child.pid : 0}\n`;
        } else if (JSON.stringify(args) === '["--user","daemon-reload"]') {
        } else if (
          JSON.stringify(args) === '["--user","enable","--now","code60-backend.service"]' ||
          JSON.stringify(args) === '["--user","start","code60-backend.service"]'
        )
          await start();
        else if (JSON.stringify(args) === '["--user","stop","code60-backend.service"]')
          await stop();
        else throw Error("Acceptance refuses unexpected backend supervisor mutations");
      } else if (name === "launchctl") {
        if (args[0] === "print" && args.length === 2) {
          if (args[1] === `gui/${process.getuid()}`)
            stdout = `services = {\n${alive() ? `com.codemanufactory.code60.backend = running\n` : ""}}\n`;
          else if (
            [label, `gui/${process.getuid()}/com.codemanufactory.code60.scheduler`].includes(
              args[1],
            )
          ) {
            if (args[1] === label && alive()) stdout = `state = running\npid = ${child.pid}\n`;
            else ok = false;
          } else throw Error("Unexpected fixture launchd label");
        } else if (
          args[0] === "bootstrap" &&
          JSON.stringify(args.slice(1)) === JSON.stringify([`gui/${process.getuid()}`, unit])
        )
          await start();
        else if (args[0] === "kickstart" && args[1] === label && args.length === 2) await start();
        else if (args[0] === "bootout" && args[1] === label && args.length === 2) await stop();
        else throw Error("Acceptance refuses unexpected backend supervisor mutations");
      } else throw Error("Acceptance refuses unexpected backend supervisor/opener mutations");
      res.end(JSON.stringify({ ok, stdout }));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ ok: false, stdout: "", error: error.message }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  return {
    socket,
    calls,
    stop,
    pid: () => (alive() ? child.pid : null),
    close: () =>
      (closing ??= (async () => {
        let failure;
        try {
          await stop();
        } catch (error) {
          failure = error;
        }
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await rm(socket, { force: true });
        if (socketDirectory !== directory) await rm(socketDirectory, { recursive: true });
        if (failure) throw failure;
      })()),
  };
}
