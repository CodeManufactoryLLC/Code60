import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startGateway } from "./server.js";

it("replaces dead-owner connection metadata after a crash and preserves a live or unverifiable owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "code60-connection-recovery-"));
  const env = {
    ...process.env,
    HOME: directory,
    XDG_CONFIG_HOME: join(directory, "config"),
    XDG_STATE_HOME: join(directory, "state"),
  };
  const root = join(directory, "state/code60/gateway");
  const path = join(root, "connection.json");
  const assets = join(directory, "assets");
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(assets);
  await writeFile(join(assets, "index.html"), "<!doctype html>");
  let gateway: Awaited<ReturnType<typeof startGateway>> | undefined;
  try {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await once(child, "exit");
    const stale = {
      version: 1,
      origin: "http://127.0.0.1:43160",
      token: "a".repeat(64),
      pid: child.pid,
    };
    await writeFile(path, JSON.stringify(stale), { mode: 0o600 });
    gateway = await startGateway({ env, assets });
    const current = JSON.parse(await readFile(path, "utf8"));
    expect(current).toMatchObject({ pid: process.pid, origin: gateway.origin });
    expect(current.token).not.toBe(stale.token);
    await gateway.stop();
    gateway = undefined;
    const live = JSON.stringify({ ...stale, pid: process.pid });
    await writeFile(path, live, { mode: 0o600 });
    await expect(startGateway({ env, assets })).rejects.toThrow("ownership could not be verified");
    expect(await readFile(path, "utf8")).toBe(live);
    const invalid = JSON.stringify({ ...stale, origin: "http://192.168.0.16:43160" });
    await writeFile(path, invalid, { mode: 0o600 });
    await expect(startGateway({ env, assets })).rejects.toThrow("connection is invalid");
    expect(await readFile(path, "utf8")).toBe(invalid);
  } finally {
    await gateway?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
