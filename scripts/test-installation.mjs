import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const api = await import(pathToFileURL(resolve("build/distribution/management/index.js")).href);
const home = await realpath(await mkdtemp(join(tmpdir(), "code60 shell ' acceptance ")));
const results = [];
try {
  const env = { HOME: home, PATH: "/usr/bin:/bin", SHELL: "/bin/bash" };
  const installed = await api.installManagedRelease({
    env,
    runtimeDirectory: resolve("build/distribution"),
    artifact: {
      identity: {
        version: "1.0.0",
        os: process.platform,
        arch: process.arch,
        archive: { sha256: "a".repeat(64) },
      },
      acquire: async ({ parent }) => {
        const owned = await mkdtemp(join(parent, ".code60-payload-"));
        const root = join(owned, "application");
        await mkdir(join(root, "dist/management"), { recursive: true, mode: 0o700 });
        await writeFile(join(root, "package.json"), '{"type":"module"}');
        await writeFile(join(root, "payload.json"), "{}");
        await writeFile(
          join(root, "dist/management/cli.js"),
          'export async function runManagement(args){if(args[0]!=="--help")throw Error("Unexpected shell fixture invocation");console.log("Code60 shell fixture");}',
        );
        return { root, owned };
      },
    },
  });
  for (const shell of ["bash", "zsh", "fish"]) {
    let executable;
    try {
      executable = (await execute("/usr/bin/which", [shell], { timeout: 5000 })).stdout.trim();
    } catch {
      if (shell !== "fish" || process.argv.includes("--require-fish"))
        throw Error(`Required shell unavailable: ${shell}`);
      results.push({ shell, status: "BLOCKED", reason: "not installed on this host" });
      continue;
    }
    const shellEnv = {
      ...env,
      SHELL: executable,
      ...(shell === "zsh" ? { ZDOTDIR: join(home, "zsh custom") } : {}),
      ...(shell === "fish" ? { XDG_CONFIG_HOME: join(home, "fish custom") } : {}),
    };
    if (shell === "zsh") await mkdir(shellEnv.ZDOTDIR, { recursive: true });
    const version = (
      await execute(executable, ["--version"], { env: shellEnv, timeout: 5000 })
    ).stdout.split("\n")[0];
    const preview = await api.planShellIntegration(shellEnv);
    assert.equal(preview.manual.length, 0);
    const applied = await api.applyShellIntegration(preview, { approved: true, interactive: true });
    assert.equal(applied.manual.length, 0);
    for (const login of [false, true]) {
      const args =
        shell === "fish"
          ? [...(login ? ["--login"] : []), "--interactive", "--command", "code60 --help"]
          : [...(login ? ["--login"] : []), "-i", "-c", "code60 --help"];
      const result = await execute(executable, args, {
        env: shellEnv,
        cwd: "/",
        timeout: 15000,
        maxBuffer: 1024 * 1024,
      });
      assert.match(result.stdout, /Code60 shell fixture/);
      results.push({ shell, executable, version, login, status: "PASS" });
    }
    assert.equal((await api.planShellIntegration(shellEnv)).edits.length, 0);
  }
  const output = join("test-results/installation", `${Date.now()}-${process.pid}`);
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(
    join(output, "shells.json"),
    JSON.stringify(
      {
        fixture:
          "process-level shell/launcher integration; full production golden journey is separate",
        results,
        launcher: installed.launcher,
      },
      null,
      2,
    ),
  );
  console.log(`Shell integration results: ${output}`);
  for (const item of results) console.log(`${item.shell} ${item.login ?? ""}: ${item.status}`);
} finally {
  await rm(home, { recursive: true, force: true });
}
