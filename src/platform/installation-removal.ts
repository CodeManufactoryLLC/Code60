import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readlink, rmdir, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  absoluteInstallationPath,
  installationDirectory,
  installationFileCode,
  syncInstallationDirectory,
} from "./installation-files.js";

interface RemovalIdentity {
  dev: string;
  ino: string;
  mode: number;
}
export type InstallationRemovalEntry = RemovalIdentity &
  (
    | { path: string; type: "directory" }
    | { path: string; type: "file"; size: number; sha256: string }
    | { path: string; type: "link"; target: string }
  );
export interface InstallationRemovalInventory {
  schema: 1;
  root: string;
  entries: InstallationRemovalEntry[];
}
const maximumEntries = 200_000;
const maximumBytes = 8 * 1024 ** 3;
const fail = () =>
  new Error(
    "Removal ownership changed; preserve remaining files and inspect the uninstall receipt",
  );

function containedLink(root: string, path: string, target: string) {
  return (
    !isAbsolute(target) &&
    !/[\0\r\n]/.test(target) &&
    resolve(dirname(join(root, path)), target).startsWith(`${root}/`)
  );
}
function validate(root: string, value: InstallationRemovalInventory) {
  if (
    absoluteInstallationPath(root) !== root ||
    root === "/" ||
    value.schema !== 1 ||
    value.root !== root ||
    !Array.isArray(value.entries) ||
    !value.entries.length ||
    value.entries.length > maximumEntries
  )
    throw fail();
  const entries = new Map<string, InstallationRemovalEntry>();
  let bytes = 0;
  for (const entry of value.entries) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      Buffer.byteLength(entry.path) > 4096 ||
      /[\0\r\n]/.test(entry.path) ||
      (entry.path !== "" &&
        entry.path.split("/").some((part) => !part || part === "." || part === "..")) ||
      typeof entry.dev !== "string" ||
      !/^[0-9]+$/.test(entry.dev) ||
      typeof entry.ino !== "string" ||
      !/^[0-9]+$/.test(entry.ino) ||
      !Number.isInteger(entry.mode) ||
      entry.mode < 0 ||
      entry.mode > 0o777 ||
      (entry.mode & 0o022) !== 0 ||
      entries.has(entry.path)
    )
      throw fail();
    if (entry.type === "file") {
      if (
        !Number.isSafeInteger(entry.size) ||
        entry.size < 0 ||
        !/^[a-f0-9]{64}$/.test(entry.sha256)
      )
        throw fail();
      bytes += entry.size;
      if (bytes > maximumBytes) throw fail();
    } else if (entry.type === "link") {
      // Link permission bits have no access-control meaning on POSIX.
      if (typeof entry.target !== "string" || !containedLink(root, entry.path, entry.target))
        throw fail();
    } else if (entry.type !== "directory") throw fail();
    entries.set(entry.path, entry);
  }
  if (entries.get("")?.type !== "directory") throw fail();
  for (const entry of entries.values()) {
    if (
      entry.path &&
      entries.get(dirname(entry.path) === "." ? "" : dirname(entry.path))?.type !== "directory"
    )
      throw fail();
  }
  return entries;
}

async function inspect(
  root: string,
  path: string,
  signal?: AbortSignal,
): Promise<InstallationRemovalEntry> {
  signal?.throwIfAborted();
  const full = path ? join(root, path) : root;
  await installationDirectory(dirname(full));
  const before = await lstat(full, { bigint: true });
  if (before.uid !== BigInt(process.getuid?.() ?? -1)) throw fail();
  const identity = {
    dev: String(before.dev),
    ino: String(before.ino),
    mode: Number(before.mode & 0o777n),
  };
  if (before.isSymbolicLink()) {
    const target = await readlink(full);
    const after = await lstat(full, { bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino || !containedLink(root, path, target))
      throw fail();
    // Normalize link mode: symlink permissions are ignored and commonly 0777.
    return { ...identity, mode: 0, path, type: "link", target };
  }
  if (before.mode & 0o7022n) throw fail();
  if (before.isDirectory()) return { ...identity, path, type: "directory" };
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximumBytes)) throw fail();
  const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const start = await file.stat({ bigint: true });
    if (
      start.dev !== before.dev ||
      start.ino !== before.ino ||
      start.ctimeNs !== before.ctimeNs ||
      start.mtimeNs !== before.mtimeNs ||
      start.mode !== before.mode ||
      start.uid !== before.uid ||
      start.nlink !== 1n
    )
      throw fail();
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(1024 * 1024);
    let size = 0;
    for (;;) {
      signal?.throwIfAborted();
      const part = await file.read(buffer, 0, buffer.length, size);
      if (!part.bytesRead) break;
      size += part.bytesRead;
      if (size > maximumBytes) throw fail();
      hash.update(buffer.subarray(0, part.bytesRead));
    }
    const after = await file.stat({ bigint: true });
    const entry = await lstat(full, { bigint: true });
    if (
      size !== Number(start.size) ||
      after.ctimeNs !== start.ctimeNs ||
      after.mtimeNs !== start.mtimeNs ||
      entry.dev !== start.dev ||
      entry.ino !== start.ino ||
      entry.ctimeNs !== after.ctimeNs ||
      after.nlink !== 1n ||
      after.mode !== start.mode ||
      after.uid !== start.uid
    )
      throw fail();
    return { ...identity, path, type: "file", size, sha256: hash.digest("hex") };
  } finally {
    await file.close();
  }
}

/** Capture identity and bytes, never following links. The caller must first establish receipt ownership. */
export async function inventoryInstallationRemoval(
  root: string,
  signal?: AbortSignal,
): Promise<InstallationRemovalInventory> {
  root = absoluteInstallationPath(root);
  await installationDirectory(root, false, true);
  const entries: InstallationRemovalEntry[] = [];
  let bytes = 0;
  async function walk(path: string) {
    const entry = await inspect(root, path, signal);
    entries.push(entry);
    if (entries.length > maximumEntries) throw fail();
    if (entry.type === "file") bytes += entry.size;
    if (bytes > maximumBytes) throw fail();
    if (entry.type === "directory") {
      for (const name of (await readdir(join(root, path))).sort())
        await walk(path ? `${path}/${name}` : name);
    }
  }
  await walk("");
  const inventory: InstallationRemovalInventory = { schema: 1, root, entries };
  validate(root, inventory);
  return inventory;
}
const same = (left: InstallationRemovalEntry, right: InstallationRemovalEntry) =>
  left.path === right.path &&
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.mode === right.mode &&
  left.type === right.type &&
  (left.type !== "file" ||
    (right.type === "file" && left.size === right.size && left.sha256 === right.sha256)) &&
  (left.type !== "link" || (right.type === "link" && left.target === right.target));

/** Resume only the recorded removal; missing entries are previous progress, never permission to claim new files. */
export async function removeInstallationInventory(
  root: string,
  inventory: InstallationRemovalInventory,
  options: { signal?: AbortSignal; checkpoint?(path: string): Promise<void> } = {},
) {
  const expected = validate(root, inventory);
  options.signal?.throwIfAborted();
  const present = await lstat(root).catch((error: unknown) => {
    if (installationFileCode(error) !== "ENOENT") throw error;
    return null;
  });
  if (!present) return;
  // Check the entire remainder before the first mutation. Outside additions,
  // replaced directories and modified files remain intact for explicit recovery.
  const actual = await inventoryInstallationRemoval(root, options.signal);
  for (const entry of actual.entries) {
    const owned = expected.get(entry.path);
    if (!owned || !same(owned, entry)) throw fail();
  }
  for (const entry of [...actual.entries].reverse()) {
    options.signal?.throwIfAborted();
    await options.checkpoint?.(entry.path);
    let parent = entry.path ? dirname(entry.path) : "";
    while (entry.path) {
      const relative = parent === "." ? "" : parent;
      const recorded = expected.get(relative);
      if (!recorded || !same(recorded, await inspect(root, relative, options.signal))) throw fail();
      if (!relative) break;
      parent = dirname(relative);
    }
    if (!same(entry, await inspect(root, entry.path, options.signal))) throw fail();
    const full = join(root, entry.path);
    if (entry.type === "directory") await rmdir(full);
    else await unlink(full);
    await syncInstallationDirectory(dirname(full));
  }
}
