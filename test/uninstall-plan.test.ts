import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { installManagedRelease, planManagedRemoval } from "../src/management/index.js";

const roots: string[] = [];
const hash = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(
  transform?: (files: { path: string; type: string; sha256: string; size: number }[]) => unknown[],
  directories?: string[],
) {
  const home = await realpath(await mkdtemp(join(tmpdir(), "code60 uninstall plan ' ")));
  roots.push(home);
  const env = { HOME: home, PATH: "/usr/bin:/bin", SHELL: "/bin/bash" };
  const installed = await installManagedRelease({
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
        for (const path of directories ?? [])
          await mkdir(join(root, path), { recursive: true, mode: 0o700 });
        const contents = {
          "dist/management/cli.js": "export async function runManagement(){}",
          NOTICE: "Notice fixture\n",
        };
        for (const [path, text] of Object.entries(contents))
          await writeFile(join(root, path), text, { mode: 0o600 });
        const files = Object.entries(contents).map(([path, text]) => ({
          path,
          type: "0",
          size: Buffer.byteLength(text),
          sha256: hash(text),
        }));
        await writeFile(
          join(root, "payload.json"),
          JSON.stringify({
            schemaVersion: 1,
            version: "1.0.0",
            os: process.platform,
            arch: process.arch,
            files: transform?.(files) ?? files,
            ...(directories ? { directories: ["dist", "dist/management", ...directories] } : {}),
          }),
        );
        return { root, owned };
      },
    },
  });
  return { home, env, ...installed };
}
it("plans only receipted release/activation inventory and leaves retained data and foreign resources untouched", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "databases"), { mode: 0o700 });
  await writeFile(join(f.root, "databases/default.sqlite"), "retained customer data", {
    mode: 0o600,
  });
  await mkdir(join(f.root, "releases/foreign"), { mode: 0o700 });
  await mkdir(join(f.root, "activations/foreign"), { mode: 0o700 });
  const before = await readdir(f.root);
  const plan = await planManagedRemoval(f.env);
  expect(plan?.launcherOwned).toBe(true);
  expect(plan?.releases.map((item) => item.root)).toEqual([f.release]);
  expect(plan?.activations).toHaveLength(1);
  expect(plan?.residuals.sort()).toEqual([
    join(f.root, "activations/foreign"),
    join(f.root, "releases/foreign"),
  ]);
  expect(
    plan?.releases
      .flatMap((item) => item.entries)
      .some((entry) => entry.path.includes("databases")),
  ).toBe(false);
  expect(await readdir(f.root)).toEqual(before);
  expect(await readFile(join(f.root, "databases/default.sqlite"), "utf8")).toBe(
    "retained customer data",
  );
});

it("owns explicitly receipted empty platform directories and still refuses a later outside directory", async () => {
  const f = await fixture(undefined, [
    "node_modules",
    "node_modules/native",
    "node_modules/native/empty-platform",
  ]);
  const plan = await planManagedRemoval(f.env);
  expect(plan?.releases[0]?.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "node_modules/native/empty-platform", type: "directory" }),
    ]),
  );
  await mkdir(join(f.release, "node_modules/native/outside"), { mode: 0o700 });
  await expect(planManagedRemoval(f.env)).rejects.toThrow("unowned contents");
  expect((await lstat(join(f.release, "node_modules/native/outside"))).isDirectory()).toBe(true);
});
it.each(["modified-payload", "extra-file", "empty-directory", "extra-support"])(
  "rejects uncertain active ownership: %s",
  async (change) => {
    const f = await fixture();
    if (change === "modified-payload") await writeFile(join(f.release, "NOTICE"), "outside edit");
    if (change === "extra-file") await writeFile(join(f.release, "foreign.txt"), "foreign");
    if (change === "empty-directory") await mkdir(join(f.release, "foreign"), { mode: 0o700 });
    if (change === "extra-support") {
      const generations = await readdir(join(f.root, "activations"));
      await writeFile(
        join(f.root, "activations", generations[0] ?? "missing", "foreign.txt"),
        "foreign",
      );
    }
    await expect(planManagedRemoval(f.env)).rejects.toThrow("inventory");
    expect((await lstat(f.release)).isDirectory()).toBe(true);
  },
);
it.each(["/absolute", "../outside", "nested/../../outside", "a//b", "a\\b"])(
  "rejects unsafe manifest paths before deriving directory ownership: %j",
  async (path) => {
    const f = await fixture((files) => [...files, { ...files[0], path }]);
    await expect(planManagedRemoval(f.env)).rejects.toThrow("Unsafe removal inventory path");
    expect(await readFile(join(f.release, "NOTICE"), "utf8")).toBe("Notice fixture\n");
  },
);
it("reports a replaced launcher without claiming or changing its contents", async () => {
  const f = await fixture();
  await rm(f.launcher);
  await writeFile(f.launcher, "foreign package manager launcher", { mode: 0o700 });
  const plan = await planManagedRemoval(f.env);
  expect(plan?.launcherOwned).toBe(false);
  expect(plan?.residuals).toContain(f.launcher);
  expect(await readFile(f.launcher, "utf8")).toBe("foreign package manager launcher");
});
it("does not create storage in an uninstalled HOME and honors cancellation", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "code60 no install ")));
  roots.push(home);
  expect(await planManagedRemoval({ HOME: home })).toBe(null);
  expect(await readdir(home)).toEqual([]);
  await expect(
    planManagedRemoval({ HOME: home }, AbortSignal.abort(Error("cancelled"))),
  ).rejects.toThrow("cancelled");
});
it("refuses unsafe receipts and activation directories without changing them", async () => {
  const f = await fixture();
  await chmod(join(f.root, "installation.json"), 0o644);
  await expect(planManagedRemoval(f.env)).rejects.toThrow("permissions");
  await chmod(join(f.root, "installation.json"), 0o600);
  await rm(join(f.root, "activations"), { recursive: true });
  await symlink(f.home, join(f.root, "activations"));
  await expect(planManagedRemoval(f.env)).rejects.toThrow("Unsafe installation directory");
});
