import { mkdir, mkdtemp, open, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { initializeVolumes } from "../.devcontainer/init-volumes.mjs";

const directories = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "code60-provider-home-"));
  directories.push(root);
  for (const name of ["home", "dependencies", "build", "npm", "browsers", "models"])
    await mkdir(join(root, name));
  return root;
}

it("makes provider storage private without changing existing login files", async () => {
  const root = await fixture();
  const auth = join(root, "home", "synthetic-auth.json");
  await writeFile(auth, '{"fixture":"retained"}', { mode: 0o600 });
  for (let n = 0; n < 2; n++) await initializeVolumes(root, process.getuid(), process.getgid());
  expect((await stat(join(root, "home"))).mode & 0o777).toBe(0o700);
  const file = await open(auth, "r");
  try {
    expect((await file.stat()).mode & 0o777).toBe(0o600);
    expect(await file.readFile("utf8")).toBe('{"fixture":"retained"}');
  } finally {
    await file.close();
  }
});

it("refuses a symlink in place of the provider home", async () => {
  const root = await fixture();
  await rm(join(root, "home"), { recursive: true });
  await symlink(join(root, "npm"), join(root, "home"));
  const previousMode = (await stat(join(root, "npm"))).mode;
  await expect(initializeVolumes(root, process.getuid(), process.getgid())).rejects.toThrow(
    "provider home directory",
  );
  expect((await stat(join(root, "npm"))).mode).toBe(previousMode);
});

it.each([
  [0, 0],
  [-1, 1000],
  [1000, -1],
  [1.5, 1000],
])("rejects an invalid provider owner (%j)", async (uid, gid) => {
  await expect(initializeVolumes("/unused", uid, gid)).rejects.toThrow("non-root");
});
