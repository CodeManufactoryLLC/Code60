import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { installAppImage } from "./appimage-update.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "code60-update-"));
  directories.push(directory);
  const destination = join(directory, "Code60 '雪 space.AppImage");
  const source = join(directory, "download.AppImage");
  await writeFile(destination, "old version");
  await writeFile(source, "new version");
  return { directory, source, destination };
}
it("replaces the AppImage atomically, preserving its custom filename", async () => {
  const { directory, source, destination } = await fixture();
  await installAppImage(source, destination);
  expect(await readFile(destination, "utf8")).toBe("new version");
  if (process.platform !== "win32") expect((await stat(destination)).mode & 0o777).toBe(0o755);
  expect(await readdir(directory)).toHaveLength(2);
});
it("keeps the old AppImage when staging fails", async () => {
  const { directory, destination } = await fixture();
  await expect(installAppImage(join(directory, "missing"), destination)).rejects.toThrow();
  expect(await readFile(destination, "utf8")).toBe("old version");
  expect(await readdir(directory)).toHaveLength(2);
});
it.skipIf(process.platform === "win32")(
  "rejects symlinks rather than replacing unrelated files",
  async () => {
    const { directory, source, destination } = await fixture();
    const link = join(directory, "link");
    await symlink(destination, link);
    await expect(installAppImage(source, link)).rejects.toThrow("regular file");
    expect(await readFile(destination, "utf8")).toBe("old version");
  },
);
