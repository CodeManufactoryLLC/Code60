import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { desktopPath } from "./environment.js";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "code60-path-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});
async function shell(script: string) {
  const file = join(home, "fixture shell");
  await writeFile(file, `#!/bin/sh\n[ "$1" = -ilc ] || exit 90\n${script}\n`, { mode: 0o700 });
  return file;
}
const inherited = "/inherited:/usr/bin";
/** Waits for a fixture's PID, failing once the probe settles without having written one. */
async function fixturePid(file: string, settled: () => boolean): Promise<number> {
  for (;;) {
    const done = settled();
    const pid = Number(await readFile(file, "utf8").catch(() => "0"));
    if (pid > 0) return pid;
    if (done) throw new Error("The probe settled before its fixture reported a PID");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const unixTest = test.skipIf(process.platform === "win32");
function fallback(platform: NodeJS.Platform = "darwin") {
  return [
    "/inherited",
    "/usr/bin",
    join(home, ".local/bin"),
    join(home, "bin"),
    ...(platform === "darwin" ? ["/opt/homebrew/bin"] : []),
    "/usr/local/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(":");
}

unixTest("shell PATH wins, with noise, spaces, duplicates and unsafe entries removed", async () => {
  const executable = await shell(
    `echo banner; echo ignored >&2\nexport PATH='/custom tools:/usr/bin:/custom tools:relative::/inherited'\neval "$2"\necho goodbye`,
  );
  const env = { HOME: home, SHELL: executable, PATH: inherited, KEEP: "original" };
  expect(await desktopPath({ env, platform: "darwin" })).toBe(
    `/custom tools:/usr/bin:${fallback().replace(":/usr/bin", "")}`,
  );
  expect(env).toEqual({ HOME: home, SHELL: executable, PATH: inherited, KEEP: "original" });
});

unixTest.each(["exit 1", "echo no-markers", 'eval "$2"; exit 2'])(
  "failed or unsupported shell falls back: %s",
  async (script) => {
    expect(
      await desktopPath({
        env: { HOME: home, PATH: inherited, SHELL: await shell(script) },
        platform: "darwin",
      }),
    ).toBe(fallback());
  },
);

unixTest("missing shell and invalid spawn environment fall back", async () => {
  for (const extra of [{}, { BAD: "\0" }]) {
    expect(
      await desktopPath({
        env: { HOME: home, PATH: inherited, SHELL: join(home, "missing"), ...extra },
        platform: "darwin",
      }),
    ).toBe(fallback());
  }
});

unixTest("relative SHELL uses the account shell, otherwise uses the platform default", async () => {
  const executable = await shell('export PATH=/account; eval "$2"');
  expect(
    await desktopPath({
      env: { HOME: home, SHELL: "relative", PATH: inherited },
      accountShell: () => executable,
      platform: "linux",
    }),
  ).toBe(`/account:${fallback("linux")}`);
  // An already-aborted probe must not start the platform shell or read the real user's rc files.
  expect(
    await desktopPath({
      env: { HOME: home, PATH: inherited },
      accountShell: () => null,
      platform: "linux",
      signal: AbortSignal.abort(),
    }),
  ).toBe(fallback("linux"));
});

unixTest.each(["stdout", "stderr"])("bounds %s without exposing output", async (stream) => {
  const executable = await shell(
    `while :; do echo 'never log shell output' ${stream === "stderr" ? ">&2" : ""}; done`,
  );
  expect(
    await desktopPath({
      env: { HOME: home, PATH: inherited, SHELL: executable },
      platform: "darwin",
      maxOutputBytes: 128,
    }),
  ).toBe(fallback());
});

unixTest.each(["timeout", "abort", "success", "failure"])(
  "%s stops shell and its descendants",
  async (reason) => {
    const executable = await shell(
      '/bin/sleep 60 >/dev/null 2>&1 &\necho "$!" > "$HOME/child-pid"\n' +
        (reason === "success"
          ? 'export PATH=/recovered; eval "$2"'
          : reason === "failure"
            ? "exit 1"
            : "wait"),
    );
    const controller = new AbortController();
    const result = desktopPath({
      env: { HOME: home, PATH: inherited, SHELL: executable },
      platform: "darwin",
      // Freshly written fixture scripts can take seconds to start under a loaded suite.
      // Deadlines must outlast that startup, or the probe ends before there is anything to stop.
      timeoutMs: reason === "timeout" ? 5_000 : 15_000,
      signal: controller.signal,
    });
    let settled = false;
    void result.finally(() => {
      settled = true;
    });
    const pid = await fixturePid(join(home, "child-pid"), () => settled);
    if (reason === "abort") controller.abort();
    expect(await result).toBe(`${reason === "success" ? "/recovered:" : ""}${fallback()}`);
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          return true;
        }
      })
      .toBe(true);
  },
  20_000,
);

test("Windows PATH preserves drive separators and never probes a shell", async () => {
  const env = {
    Path: "C:\\Inherited Tools;C:\\Windows\\System32;relative;;C:\\Inherited Tools",
    HOME: "C:\\Users\\Test",
    SHELL: "must-not-run.exe",
  };
  let shellRead = false;
  const path = await desktopPath({
    platform: "win32",
    env,
    home: env.HOME,
    accountShell: () => {
      shellRead = true;
      throw new Error("must not read shell");
    },
    windowsPaths: async () => ({ user: "D:\\User Tools", machine: "C:\\Machine Tools" }),
  });
  expect(path.split(";").slice(0, 4)).toEqual([
    "C:\\Inherited Tools",
    "C:\\Windows\\System32",
    "D:\\User Tools",
    "C:\\Machine Tools",
  ]);
  expect(path).not.toContain("relative");
  expect(shellRead).toBe(false);
  expect(env.Path).toContain("relative");
});

test("Windows discovery failure uses inherited PATH and documented directories", async () => {
  expect(
    await desktopPath({
      platform: "win32",
      env: { PATH: "C:\\Tools" },
      home: "C:\\Users\\Test",
      windowsPaths: async () => {
        throw new Error("access denied");
      },
    }),
  ).toBe("C:\\Tools;C:\\Users\\Test\\.local\\bin;C:\\Users\\Test\\bin");
});
