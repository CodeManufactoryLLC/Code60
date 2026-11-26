import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clampDimensions, resolveUserShell, spawnOwnedPty } from "./pty.js";

describe("platform PTY", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("clamps terminal dimensions to safe bounds", () => {
    expect(clampDimensions(0, 0)).toEqual({ cols: 2, rows: 1 });
    expect(clampDimensions(9999, 9999)).toEqual({ cols: 500, rows: 200 });
    expect(clampDimensions(80.9, 24.4)).toEqual({ cols: 80, rows: 24 });
    expect(clampDimensions(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ cols: 80, rows: 24 });
  });

  it("resolves macOS and Linux shells cleanly", () => {
    const mac = resolveUserShell({ SHELL: "/bin/zsh" }, "darwin", {
      isExecutable: (path) => path === "/bin/zsh",
    });
    expect(mac).toEqual({ file: "/bin/zsh", args: ["-l"], name: "zsh" });

    const linux = resolveUserShell({ SHELL: "/nonexistent" }, "linux", {
      accountShell: () => "/bin/bash",
      isExecutable: (path) => path === "/bin/bash",
    });
    expect(linux).toEqual({ file: "/bin/bash", args: [], name: "bash" });

    expect(() =>
      resolveUserShell({ SHELL: "/missing" }, "linux", {
        accountShell: () => null,
        isExecutable: () => false,
      }),
    ).toThrow("No executable shell found");
  });

  it("spawns a real POSIX PTY in cwd, handles input/resize/exit, and cleans up on stop", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "code60-pty-test-")));
    dirs.push(dir);
    const pty = await spawnOwnedPty({
      cwd: dir,
      cols: 80,
      rows: 24,
      env: { ...process.env, SHELL: "/bin/sh", PS1: "$ " },
    });
    try {
      expect(pty.pid).toBeGreaterThan(0);
      expect(pty.shell).toBe("sh");
      expect(pty.hasExited()).toBe(false);

      let output = "";
      const off = pty.onData((chunk) => {
        output += chunk;
      });

      pty.resize(100, 30);
      pty.write("pwd\n");
      pty.write("echo CODE60_PTY_OK\n");
      pty.write("exit 0\n");

      const result = await pty.exited;
      off();
      expect(result.code).toBe(0);
      expect(pty.hasExited()).toBe(true);
      expect(output).toContain(dir);
      expect(output).toContain("CODE60_PTY_OK");
    } finally {
      await pty.stop();
    }
  });

  it("clears /dev/null GIT_CONFIG_GLOBAL and disabled GIT_TERMINAL_PROMPT in interactive shells", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "code60-pty-env-")));
    dirs.push(dir);
    const pty = await spawnOwnedPty({
      cwd: dir,
      cols: 80,
      rows: 24,
      env: {
        ...process.env,
        SHELL: "/bin/sh",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    try {
      let output = "";
      const off = pty.onData((chunk) => {
        output += chunk;
      });
      pty.write('printf "CFG=[%s] PROMPT=[%s]\\n" "$GIT_CONFIG_GLOBAL" "$GIT_TERMINAL_PROMPT"\n');
      pty.write("exit 0\n");
      const result = await pty.exited;
      off();
      expect(result.code).toBe(0);
      expect(output).toContain("CFG=[] PROMPT=[]");
    } finally {
      await pty.stop();
    }
  });

  it("stops an idle POSIX PTY cleanly", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "code60-pty-stop-")));
    dirs.push(dir);
    const pty = await spawnOwnedPty({
      cwd: dir,
      cols: 80,
      rows: 24,
      env: { ...process.env, SHELL: "/bin/sh" },
    });
    expect(pty.hasExited()).toBe(false);
    await pty.stop();
    expect(pty.hasExited()).toBe(true);
    expect(() => process.kill(pty.pid, 0)).toThrow();
  });
});
