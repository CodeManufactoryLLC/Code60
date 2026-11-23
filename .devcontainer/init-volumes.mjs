import { chown, lchown, lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

// This root-only, short-lived service sees named caches, never the checkout.
const [uid, gid] = process.argv.slice(2).map(Number);
if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid) || gid < 0)
  throw new Error("Expected a non-root cache owner");
async function own(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) {
    await lchown(path, uid, gid);
    return;
  }
  if (info.uid === uid && info.gid === gid) return;
  if (info.isDirectory()) for (const entry of await readdir(path)) await own(join(path, entry));
  await chown(path, uid, gid);
}
for (const name of ["dependencies", "build", "npm", "browsers", "models"])
  await own(`/cache/${name}`);
