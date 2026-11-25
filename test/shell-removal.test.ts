import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  applyShellIntegration,
  applyShellRemoval,
  installManagedRelease,
  planShellIntegration,
  planShellRemoval,
} from "../src/management/index.js";
import { installationPaths, readInstallation } from "../src/management/install-state.js";

const roots: string[] = [];
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture(shell = "bash", before = "# customer's original profile\n") {
  const home = await realpath(await mkdtemp(join(tmpdir(), "code60 shell removal ' ")));
  roots.push(home);
  const env = { HOME: home, PATH: "/usr/bin:/bin", SHELL: `/bin/${shell}` };
  await installManagedRelease({
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
        await writeFile(join(root, "payload.json"), "{}");
        await writeFile(
          join(root, "dist/management/cli.js"),
          "export async function runManagement(){}",
        );
        return { root, owned };
      },
    },
  });
  const record = await readInstallation(await installationPaths(env));
  if (!record) throw Error("Fixture installation missing");
  const planned = await planShellIntegration(env);
  for (const edit of planned.edits) {
    await mkdir(join(edit.path, ".."), { recursive: true });
    await writeFile(edit.path, before, { mode: 0o600 });
  }
  const preview = await planShellIntegration(env);
  expect(
    (await applyShellIntegration(preview, { approved: true, interactive: true })).manual,
  ).toEqual([]);
  return { home, env, record, profiles: preview.edits.map((edit) => edit.path), before };
}
it.each(["bash", "zsh", "fish"])(
  "previews exact owned %s additions and preserves all unrelated bytes",
  async (shell) => {
    const f = await fixture(shell, "# before without newline");
    for (const path of f.profiles)
      await writeFile(path, `${await readFile(path, "utf8")}# unrelated later addition\n`);
    const preview = await planShellRemoval(f.record);
    expect(preview.manual).toEqual([]);
    expect(preview.edits.length).toBe(shell === "fish" ? 1 : 2);
    expect(preview.edits.every((edit) => !edit.remove.includes("unrelated later"))).toBe(true);
    const result = await applyShellRemoval(f.record, preview, {
      approved: true,
      interactive: true,
    });
    expect(result.applied).toEqual(f.profiles);
    expect(result.manual).toEqual([]);
    for (const path of f.profiles)
      expect(await readFile(path, "utf8")).toBe(`${f.before}# unrelated later addition\n`);
    expect((await planShellRemoval(f.record)).edits).toEqual([]);
  },
);
it.each([
  { approved: false, interactive: true },
  { approved: true, interactive: false },
])("requires separate interactive profile consent: %j", async (consent) => {
  const f = await fixture();
  const before = await Promise.all(f.profiles.map((path) => readFile(path, "utf8")));
  const result = await applyShellRemoval(f.record, await planShellRemoval(f.record), consent);
  expect(result.applied).toEqual([]);
  expect(result.manual.join(" ")).toContain("retained");
  expect(await Promise.all(f.profiles.map((path) => readFile(path, "utf8")))).toEqual(before);
});
it("preserves modified owned blocks and unsafe profile links", async () => {
  const f = await fixture();
  const [first, second] = f.profiles;
  if (!first || !second) throw Error("Fixture profiles missing");
  const changed = (await readFile(first, "utf8")).replace("export PATH=", "export CHANGED_PATH=");
  await writeFile(first, changed);
  await rm(second);
  await symlink(first, second);
  const preview = await planShellRemoval(f.record);
  expect(preview.edits).toEqual([]);
  expect(preview.manual).toHaveLength(2);
  expect(await readFile(first, "utf8")).toBe(changed);
});
it("records partial completion and preserves a profile changed after approval", async () => {
  const f = await fixture();
  const preview = await planShellRemoval(f.record);
  const second = f.profiles[1];
  if (!second) throw Error("Fixture second profile missing");
  const changed = `${await readFile(second, "utf8")}# outside edit after preview\n`;
  await writeFile(second, changed);
  const result = await applyShellRemoval(f.record, preview, { approved: true, interactive: true });
  expect(result.applied).toEqual([f.profiles[0]]);
  expect(result.manual.join(" ")).toContain("changed since preview");
  expect(await readFile(second, "utf8")).toBe(changed);
  const next = await planShellRemoval(f.record);
  expect(next.edits.map((edit) => edit.path)).toEqual([second]);
});
it("preserves CRLF and verifies ownership instead of accepting a forged preview", async () => {
  const f = await fixture("bash", "# original\r\n");
  const preview = await planShellRemoval(f.record);
  const first = preview.edits[0];
  if (!first) throw Error("Fixture preview missing");
  const forged = { ...preview, edits: [{ ...first, remove: f.before }] };
  const result = await applyShellRemoval(f.record, forged, { approved: true, interactive: true });
  expect(result.applied).toEqual([]);
  expect(result.manual.join(" ")).toContain("changed since preview");
  await applyShellRemoval(f.record, preview, { approved: true, interactive: true });
  for (const path of f.profiles) expect(await readFile(path, "utf8")).toBe(f.before);
});
