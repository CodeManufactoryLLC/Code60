import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  type FileContext,
  type FileDirectory,
  type FilePreview,
  type FileSnapshot,
  parseFileContext,
} from "../bridge/index.js";
import { containedPath, helperOutput } from "../platform/index.js";

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
  if (!containedPath(root, resolved)) throw new Error("This path is outside the selected root.");
  return resolved;
}

async function directory(root: string, path: string, limit: number): Promise<FileDirectory> {
  const result: FileDirectory = { path, entries: [], error: null, truncated: false };
  try {
    if (process.platform === "win32") {
      const value: unknown = JSON.parse(
        (await helperOutput(["list", root, path])).toString("utf8"),
      );
      if (!Array.isArray(value) || value.length > directoryEntryLimit + 1)
        throw new Error("Invalid native directory listing");
      for (const entry of value.slice(0, limit)) {
        if (
          !entry ||
          typeof entry.name !== "string" ||
          !["file", "directory", "symlink", "other"].includes(entry.kind)
        )
          throw new Error("Invalid native directory entry");
        result.entries.push({
          name: entry.name,
          path: path ? `${path}/${entry.name}` : entry.name,
          kind: entry.kind,
        });
      }
      result.truncated = value.length > limit;
      result.entries.sort(
        (a, b) =>
          Number(b.kind === "directory") - Number(a.kind === "directory") ||
          a.name.localeCompare(b.name),
      );
      return result;
    }
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
    if (process.platform === "win32") {
      const output = await helperOutput(["preview", root, path], previewByteLimit + 128);
      const end = output.indexOf(10);
      const header = output.subarray(0, end).toString("ascii");
      if (end < 0 || !/^\d+ \d+$/.test(header)) throw new Error("Invalid native preview");
      const [size, modified] = header.split(" ").map(Number);
      result.size = size as number;
      result.modifiedAt = new Date(modified as number).toISOString();
      result.text = decodePreview(output.subarray(end + 1));
      return result;
    }
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
      result.text = decodePreview(buffer.subarray(0, length));
    } finally {
      await file.close();
    }
  } catch (error) {
    result.error = message(error);
  }
  return result;
}

function decodePreview(bytes: Uint8Array): string {
  if (bytes.length > previewByteLimit) throw new Error("Preview unavailable: file exceeds 1 MiB.");
  if (bytes.includes(0)) throw new Error("Preview unavailable: binary file.");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Preview unavailable: file is not UTF-8 text.");
  }
}

/** Reads only the requested expanded folders and one preview, with bounded output. */
export async function readFiles(
  context: FileContext,
  current: () => boolean,
): Promise<FileSnapshot> {
  parseFileContext(context);
  const root = process.platform === "win32" ? context.root : await realpath(context.root);
  if ((await lstat(context.root)).isSymbolicLink() || root !== context.root)
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
