import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, copyFile, lstat, rename, unlink } from "node:fs/promises";
import { isAbsolute } from "node:path";

/** Stage beside the original so a failed copy never removes the installed app. */
export async function installAppImage(file: string, destination: string): Promise<void> {
  if (!isAbsolute(destination) || !(await lstat(destination)).isFile())
    throw new Error("The installed AppImage must be a regular file at an absolute path");
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await copyFile(file, temporary, constants.COPYFILE_EXCL);
    await chmod(temporary, 0o755);
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
