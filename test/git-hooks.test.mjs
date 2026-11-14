import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { manageHooks } from "../scripts/git-hooks.mjs";

const execute = promisify(execFile);
const directories = [];
const environment = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull };
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "code60 hook fixture "));
  directories.push(root);
  const git = (...args) =>
    execute("git", ["-C", root, ...args], { env: environment, timeout: 5000 });
  await git("init", "-q");
  await mkdir(join(root, ".githooks"));
  await writeFile(
    join(root, ".githooks/pre-commit"),
    await readFile(new URL("../.githooks/pre-commit", import.meta.url)),
    { mode: 0o755 },
  );
  await writeFile(join(root, "sentinel.txt"), "staged content\n");
  await git("add", "sentinel.txt");
  await writeFile(join(root, "sentinel.txt"), "unstaged content\n");
  return { root, git };
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("opt-in repository hooks", () => {
  it("installs explicitly, reports status, and uninstalls only its own setting", async () => {
    const { root, git } = await fixture();
    expect(await manageHooks(root, "status", environment)).toEqual({ state: "not-installed" });
    expect(await manageHooks(root, "install", environment)).toEqual({ state: "installed" });
    expect(await manageHooks(root, "install", environment)).toEqual({ state: "installed" });
    expect(await manageHooks(root, "status", environment)).toEqual({ state: "installed" });
    expect((await git("config", "--local", "--get", "core.hooksPath")).stdout.trim()).toBe(
      ".githooks",
    );
    expect(await manageHooks(root, "uninstall", environment)).toEqual({ state: "not-installed" });
    await expect(manageHooks(root, "uninstall", environment)).rejects.toThrow("Refusing");
  });
  it("preserves configured hook paths and existing active hooks", async () => {
    const { root, git } = await fixture();
    await git("config", "--local", "core.hooksPath", "user hooks");
    await expect(manageHooks(root, "install", environment)).rejects.toThrow("preserved");
    await expect(manageHooks(root, "uninstall", environment)).rejects.toThrow("Refusing");
    expect((await git("config", "--local", "--get", "core.hooksPath")).stdout.trim()).toBe(
      "user hooks",
    );
    await git("config", "--local", "--unset", "core.hooksPath");
    await writeFile(join(root, ".git/hooks/pre-push"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await expect(manageHooks(root, "install", environment)).rejects.toThrow("would be hidden");
  });
  it("does not override inherited hook policy", async () => {
    const { root, git } = await fixture();
    const global = join(root, "global.gitconfig");
    await writeFile(global, '[core]\n\thooksPath = "global hooks"\n');
    const env = { ...environment, GIT_CONFIG_GLOBAL: global };
    await expect(manageHooks(root, "install", env)).rejects.toThrow("preserved");
    await expect(git("config", "--local", "--get", "core.hooksPath")).rejects.toMatchObject({
      code: 1,
    });
  });
  it("preserves hook policy whose whitespace differs from the owned value", async () => {
    const { root, git } = await fixture();
    for (const value of [".githooks ", " .githooks", ".githooks\r", ".githooks\n", ""]) {
      await git("config", "--local", "core.hooksPath", value);
      expect(await manageHooks(root, "status", environment)).toEqual({ state: "conflict" });
      await expect(manageHooks(root, "install", environment)).rejects.toThrow("preserved");
      await expect(manageHooks(root, "uninstall", environment)).rejects.toThrow("Refusing");
      expect((await git("config", "--local", "--get", "core.hooksPath")).stdout).toBe(`${value}\n`);
    }
  });
  it("refuses missing/nonexecutable hooks without changing Git configuration", async () => {
    const { root, git } = await fixture();
    if (process.platform === "win32") await rm(join(root, ".githooks/pre-commit"));
    else await chmod(join(root, ".githooks/pre-commit"), 0o644);
    await expect(manageHooks(root, "install", environment)).rejects.toThrow();
    await expect(git("config", "--local", "--get", "core.hooksPath")).rejects.toMatchObject({
      code: 1,
    });
    await expect(manageHooks(root, "unknown", environment)).rejects.toThrow("hooks:install");
  });
  it("runs the real hook in a space-containing checkout, stops on failure, and preserves the index", async () => {
    const { root, git } = await fixture();
    const commands = ["check:instructions", "typecheck", "lint", "check:unused"];
    expect(manifest.scripts["check:precommit"]).toBe(
      commands.map((name) => `npm run ${name}`).join(" && "),
    );
    expect(manifest.scripts.prepare).toBeUndefined();
    const scripts = Object.fromEntries(commands.map((name) => [name, `node gate.mjs ${name}`]));
    scripts["check:precommit"] = manifest.scripts["check:precommit"];
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts }));
    await writeFile(
      join(root, "gate.mjs"),
      'import { appendFileSync } from "node:fs"; appendFileSync("calls", process.argv[2] + "\\n"); if (process.env.CODE60_TEST_FAIL === process.argv[2]) process.exit(17);\n',
    );
    await manageHooks(root, "install", environment);
    const before = (await git("diff", "--cached", "--binary")).stdout;
    const index = await readFile(join(root, ".git/index"));
    const sources = ["sentinel.txt", ".githooks/pre-commit", "package.json", "gate.mjs"];
    const originalFiles = await Promise.all(sources.map((file) => readFile(join(root, file))));
    await git("hook", "run", "pre-commit");
    expect((await readFile(join(root, "calls"), "utf8")).trim().split("\n")).toEqual(commands);
    await writeFile(join(root, "calls"), "");
    const failed = await execute("git", ["-C", root, "hook", "run", "pre-commit"], {
      env: { ...environment, CODE60_TEST_FAIL: "typecheck" },
      timeout: 15_000,
    }).catch((error) => error);
    expect(failed.code).toBe(17);
    expect((await readFile(join(root, "calls"), "utf8")).trim().split("\n")).toEqual(
      commands.slice(0, 2),
    );
    expect((await git("diff", "--cached", "--binary")).stdout).toBe(before);
    expect(await readFile(join(root, ".git/index"))).toEqual(index);
    expect(await Promise.all(sources.map((file) => readFile(join(root, file))))).toEqual(
      originalFiles,
    );
    expect(await readFile(join(root, "sentinel.txt"), "utf8")).toBe("unstaged content\n");
  }, 20_000);
});
