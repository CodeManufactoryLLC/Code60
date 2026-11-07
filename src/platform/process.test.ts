import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nativeIdentity, type OwnedProcess, ownedJob, spawnOwnedProcess } from "./index.js";

const children: OwnedProcess[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => child.stop(0)));
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "code60-native-"));
  directories.push(dir);
  return dir;
}
async function launch(script: string, ...args: string[]) {
  const child = await spawnOwnedProcess(
    [process.execPath, "-e", script, ...args],
    await directory(),
  );
  children.push(child);
  return child;
}

describe("owned native processes", () => {
  it("makes repeated and concurrent stops idempotent", async () => {
    const child = await launch("setInterval(() => {}, 1000)");
    const started = Date.now();
    await Promise.all([child.stop(1000), child.stop(0), child.stop(0)]);
    await child.stop(0);
    expect(Date.now() - started).toBeLessThan(7_000);
  });

  it.runIf(process.platform === "win32")("helper failure closes the job", async () => {
    const child = await launch("setInterval(() => {}, 1000)");
    process.kill(child.supervisorPid as number);
    await child.exited;
    await child.stop(0);
    expect(await nativeIdentity(child.pid)).toBeNull();
  });

  it("reports the root exit code without waiting for stop", async () => {
    const child = await launch("setTimeout(() => process.exit(3), 100)");
    expect(await child.exited).toEqual({ code: 3, signal: null });
  });

  it("round trips executable arguments without shell interpretation", async () => {
    const args = [
      "",
      "space here",
      "雪",
      '"quoted"',
      "trailing\\",
      "%PATH%",
      "!",
      "&",
      "|",
      "^",
      "(x)",
      "<",
      ">",
    ];
    const child = await launch(
      "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
      ...args,
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    expect((await child.exited).code).toBe(0);
    await child.stop(0);
    expect(JSON.parse(output)).toEqual(args);
  });

  it.runIf(process.platform === "win32")(
    "refuses an identical-command PID with a different creation time",
    async () => {
      const child = await launch("setInterval(() => {}, 1000)");
      expect(child.identity?.job).toBeTruthy();
      const identity = child.identity as NonNullable<OwnedProcess["identity"]>;
      await expect(ownedJob("stop", child.pid, { ...identity, createdAt: "1" })).rejects.toThrow(
        /identity/,
      );
      expect(await nativeIdentity(child.pid)).toMatchObject({ createdAt: identity.createdAt });
      expect(await ownedJob("status", child.pid, identity)).toBe("alive");
    },
  );

  it("kills descendants when the root exits, without touching an unrelated sentinel", async () => {
    const dir = await directory();
    const sentinel = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    try {
      const pidFile = join(dir, "child.pid");
      const child = await launch(
        `
        const {spawn}=require('node:child_process');
        const {writeFileSync}=require('node:fs');
        const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
        writeFileSync(process.argv[1],String(child.pid));
        setTimeout(()=>process.exit(0),100);
      `,
        pidFile,
      );
      await child.exited;
      await child.stop(0);
      const pid = Number(await readFile(pidFile, "utf8"));
      expect(() => process.kill(pid, 0)).toThrow();
      expect(() => process.kill(sentinel.pid as number, 0)).not.toThrow();
    } finally {
      sentinel.kill();
    }
  });
});
