import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

/** Keep the output directory itself: it may be a container cache mount. */
export async function cleanBuild(directory) {
  const info = await lstat(directory).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info?.isDirectory()) {
    // Remove a symlink itself, never clean the directory it names.
    await rm(directory, { force: true });
    await mkdir(directory, { recursive: true });
  }
  for (const name of await readdir(directory))
    await rm(join(directory, name), { recursive: true, force: true });
}
