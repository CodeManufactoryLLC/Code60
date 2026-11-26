import { chmod, chown, lchown, lstat, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This root-only service sees named volumes, never the checkout or host home.
async function own(path, uid, gid) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) {
    await lchown(path, uid, gid);
    return;
  }
  if (info.uid === uid && info.gid === gid) return;
  if (info.isDirectory())
    for (const entry of await readdir(path)) await own(join(path, entry), uid, gid);
  await chown(path, uid, gid);
}
export async function initializeVolumes(directory, uid, gid) {
  if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid) || gid < 0)
    throw new Error("Expected a non-root cache owner");
  const home = join(directory, "home");
  if (!(await lstat(home)).isDirectory()) throw new Error("Expected a provider home directory");
  await own(home, uid, gid);
  await chmod(home, 0o700);
  const dev = join(directory, "dev");
  if (!(await lstat(dev)).isDirectory()) throw new Error("Expected a development state directory");
  await own(dev, uid, gid);
  await chmod(dev, 0o700);
  for (const name of ["dependencies", "build", "npm", "browsers", "models"])
    await own(join(directory, name), uid, gid);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [uid, gid] = process.argv.slice(2).map(Number);
  await initializeVolumes("/cache", uid, gid);
}
