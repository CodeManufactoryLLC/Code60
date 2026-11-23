import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { cleanBuild } from "../scripts/clean-build.mjs";

const directories = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "code60-build-"));
  directories.push(directory);
  return directory;
}
it("removes stale build contents while preserving the cache mount directory identity", async () => {
  const output = join(await fixture(), "dist");
  await mkdir(join(output, "stale"), { recursive: true });
  await writeFile(join(output, "stale/file.js"), "stale");
  const before = await lstat(output);
  await cleanBuild(output);
  expect((await lstat(output)).ino).toBe(before.ino);
  expect(await readdir(output)).toEqual([]);
});
it("replaces an output symlink without deleting its external target", async () => {
  const root = await fixture();
  const target = join(root, "unrelated");
  await mkdir(target);
  await writeFile(join(target, "preserve"), "untouched");
  const output = join(root, "dist");
  await symlink(target, output);
  await cleanBuild(output);
  expect(await readFile(join(target, "preserve"), "utf8")).toBe("untouched");
  expect((await lstat(output)).isDirectory()).toBe(true);
  expect(await readdir(output)).toEqual([]);
});
it("creates missing output and replaces a stale output file", async () => {
  const output = join(await fixture(), "dist");
  await cleanBuild(output);
  await rm(output, { recursive: true });
  await writeFile(output, "stale");
  await cleanBuild(output);
  expect((await lstat(output)).isDirectory()).toBe(true);
});
