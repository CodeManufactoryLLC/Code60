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
  for (const name of ["home", "dev", "dependencies", "build", "npm", "browsers", "models"])
    await mkdir(join(root, name));
  return root;
}

it("makes provider and development state private without changing existing files", async () => {
  const root = await fixture();
  const auth = join(root, "home", "synthetic-auth.json");
  const devFile = join(root, "dev", "mcp.json");
  await writeFile(auth, '{"fixture":"retained"}', { mode: 0o600 });
  await writeFile(devFile, '{"version":1,"servers":{}}', { mode: 0o600 });
  for (let n = 0; n < 2; n++) await initializeVolumes(root, process.getuid(), process.getgid());
  expect((await stat(join(root, "home"))).mode & 0o777).toBe(0o700);
  expect((await stat(join(root, "dev"))).mode & 0o777).toBe(0o700);
  for (const [path, expected] of [
    [auth, '{"fixture":"retained"}'],
    [devFile, '{"version":1,"servers":{}}'],
  ]) {
    const file = await open(path, "r");
    try {
      expect((await file.stat()).mode & 0o777).toBe(0o600);
      expect(await file.readFile("utf8")).toBe(expected);
    } finally {
      await file.close();
    }
  }
});

it("refuses a symlink in place of the provider home or development state", async () => {
  const root = await fixture();
  await rm(join(root, "home"), { recursive: true });
  await symlink(join(root, "npm"), join(root, "home"));
  const previousMode = (await stat(join(root, "npm"))).mode;
  await expect(initializeVolumes(root, process.getuid(), process.getgid())).rejects.toThrow(
    "provider home directory",
  );
  expect((await stat(join(root, "npm"))).mode).toBe(previousMode);

  const devRoot = await fixture();
  await rm(join(devRoot, "dev"), { recursive: true });
  await symlink(join(devRoot, "npm"), join(devRoot, "dev"));
  const previousDevMode = (await stat(join(devRoot, "npm"))).mode;
  await expect(initializeVolumes(devRoot, process.getuid(), process.getgid())).rejects.toThrow(
    "development state directory",
  );
  expect((await stat(join(devRoot, "npm"))).mode).toBe(previousDevMode);
});

it.each([
  [0, 0],
  [-1, 1000],
  [1000, -1],
  [1.5, 1000],
])("rejects an invalid provider owner (%j)", async (uid, gid) => {
  await expect(initializeVolumes("/unused", uid, gid)).rejects.toThrow("non-root");
});
