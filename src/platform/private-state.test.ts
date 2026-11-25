import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { lockPrivateState, privateDirectory } from "./index.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "code60 operation lock ")));
  roots.push(parent);
  return join(parent, "operation");
}
it("fails promptly on any existing non-reclaiming operation lock and leaves stale evidence intact", async () => {
  const root = await fixture();
  await privateDirectory(root);
  const lock = join(root, ".writer");
  await mkdir(lock, { mode: 0o700 });
  const name = "owner-1000000000-00000000-0000-4000-8000-000000000001";
  await writeFile(join(lock, name), "", { mode: 0o600 });
  await expect(lockPrivateState(root, { reclaimStale: false })).rejects.toThrow(lock);
  expect(await readdir(lock)).toEqual([name]);
  expect(await readFile(join(lock, name), "utf8")).toBe("");
  const release = await lockPrivateState(root);
  await release();
  await release();
  await expect(readdir(lock)).rejects.toMatchObject({ code: "ENOENT" });
});
it.each(["owner", "directory", "extra-file"] as const)(
  "refuses to release a changed %s identity without removing evidence",
  async (change) => {
    const root = await fixture();
    const release = await lockPrivateState(root, { reclaimStale: false });
    const lock = join(root, ".writer");
    const [name] = await readdir(lock);
    expect(name).toBeTruthy();
    if (change === "directory") {
      await rename(lock, join(root, "original"));
      await mkdir(lock, { mode: 0o700 });
      await writeFile(join(lock, name as string), "", { mode: 0o600 });
    } else if (change === "owner") {
      await rename(join(lock, name as string), join(root, "original-owner"));
      await writeFile(join(lock, name as string), "", { mode: 0o600 });
    } else await writeFile(join(lock, "outside"), "preserve", { mode: 0o600 });
    await expect(release()).rejects.toThrow("ownership changed");
    expect(await readdir(lock)).toContain(name);
  },
);
it("does not allow concurrent callers to release another operation's lock", async () => {
  const root = await fixture();
  const first = await lockPrivateState(root, { reclaimStale: false });
  await expect(lockPrivateState(root, { reclaimStale: false })).rejects.toThrow(
    "No lock was reclaimed",
  );
  await first();
  const second = await lockPrivateState(root, { reclaimStale: false });
  await first();
  await expect(lockPrivateState(root, { reclaimStale: false })).rejects.toThrow(
    "No lock was reclaimed",
  );
  await second();
});
