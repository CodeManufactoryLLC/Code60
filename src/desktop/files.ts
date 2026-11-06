import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { FileContext, FileDirectory, FilePreview, FileSnapshot } from "../bridge/index.js";

export const previewByteLimit = 1024 * 1024;
const directoryEntryLimit = 2000;
const totalEntryLimit = 10000;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Deliberately do not follow links, including links in intermediate directories. */
async function checkedPath(root: string, path: string): Promise<string> {
  let target = root;
  for (const part of path.split("/").filter(Boolean)) {
    target = join(target, part);
    if ((await lstat(target)).isSymbolicLink())
      throw new Error("Symbolic links are not previewed.");
  }
  const resolved = await realpath(target);
  const fromRoot = relative(root, resolved);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || fromRoot.startsWith(sep))
    throw new Error("This path is outside the selected root.");
  return resolved;
}

async function directory(root: string, path: string, limit: number): Promise<FileDirectory> {
  const result: FileDirectory = { path, entries: [], error: null, truncated: false };
  try {
    const dir = await opendir(await checkedPath(root, path));
    for await (const entry of dir) {
      if (result.entries.length >= limit) {
        result.truncated = true;
        break;
      }
      result.entries.push({
        path: path ? `${path}/${entry.name}` : entry.name,
        name: entry.name,
        kind: entry.isSymbolicLink()
          ? "symlink"
          : entry.isDirectory()
            ? "directory"
            : entry.isFile()
              ? "file"
              : "other",
      });
    }
    result.entries.sort(
      (a, b) =>
        Number(b.kind === "directory") - Number(a.kind === "directory") ||
        a.name.localeCompare(b.name),
    );
  } catch (error) {
    result.error = message(error);
  }
  return result;
}

async function preview(root: string, path: string): Promise<FilePreview> {
  const result: FilePreview = { path, text: null, size: null, modifiedAt: null, error: null };
  try {
    const target = await checkedPath(root, path);
    // Nonblocking prevents a replaced FIFO from hanging the main process; no-follow
    // rejects a last-component symlink swapped in after validation.
    const file = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await file.stat();
      if (!info.isFile()) throw new Error("Only regular files can be previewed.");
      result.size = info.size;
      result.modifiedAt = info.mtime.toISOString();
      if (info.size > previewByteLimit) throw new Error("Preview unavailable: file exceeds 1 MiB.");
      const buffer = Buffer.alloc(previewByteLimit + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > previewByteLimit) throw new Error("Preview unavailable: file exceeds 1 MiB.");
      const bytes = buffer.subarray(0, length);
      if (bytes.includes(0)) throw new Error("Preview unavailable: binary file.");
      try {
        result.text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new Error("Preview unavailable: file is not UTF-8 text.");
      }
    } finally {
      await file.close();
    }
  } catch (error) {
    result.error = message(error);
  }
  return result;
}

/** Reads only the requested expanded folders and one preview, with bounded output. */
export async function readFiles(
  context: FileContext,
  current: () => boolean,
): Promise<FileSnapshot> {
  const root = await realpath(context.root);
  if (root !== context.root)
    throw new Error("The selected root has moved or become a symbolic link.");
  const directories: FileDirectory[] = [];
  let remaining = totalEntryLimit;
  for (const path of context.directories) {
    if (!current()) break;
    const result = await directory(root, path, Math.min(directoryEntryLimit, remaining));
    remaining -= result.entries.length;
    directories.push(result);
  }
  return {
    context,
    directories,
    preview: current() && context.preview !== null ? await preview(root, context.preview) : null,
  };
}
