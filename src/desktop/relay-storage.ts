import { isUtf8 } from "node:buffer";
import { randomUUID } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import { lstat, open, readdir, rmdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  atomicReplace,
  createPrivateDirectory,
  helperOutput,
  privateDirectory,
  writePrivateFile,
} from "../platform/index.js";
import { changedJournalFields, RelayPersistenceError } from "./relay-persistence.js";

export const storageCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code;

export async function verifyRelayStorage(path: string, directory: boolean): Promise<BigIntStats> {
  const info = await lstat(path, { bigint: true });
  if (
    info.isSymbolicLink() ||
    (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1n)
  )
    throw new Error("Unsafe Relay storage");
  if (process.platform === "win32") await helperOutput(["verify-private", path]);
  else if ((info.mode & 0o077n) !== 0n || info.uid !== BigInt(process.getuid?.() ?? -1))
    throw new Error("Unsafe Relay permissions");
  return info;
}

export async function relayFile(path: string, writable = false) {
  const checked = await verifyRelayStorage(path, false);
  const handle = await open(
    path,
    (writable ? constants.O_RDWR : constants.O_RDONLY) |
      constants.O_NONBLOCK |
      (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const current = await handle.stat({ bigint: true });
    const entry = await verifyRelayStorage(path, false);
    if (
      current.dev !== checked.dev ||
      current.ino !== checked.ino ||
      current.dev !== entry.dev ||
      current.ino !== entry.ino ||
      !current.isFile() ||
      current.nlink !== 1n ||
      (process.platform !== "win32" &&
        ((current.mode & 0o077n) !== 0n || current.uid !== BigInt(process.getuid?.() ?? -1)))
    )
      throw new RelayPersistenceError("open", "identity", undefined, [
        ...new Set([
          ...changedJournalFields(checked, current),
          ...changedJournalFields(current, entry),
        ]),
      ]);
    return handle;
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

export async function readRelayState(path: string, maximumBytes = 16_384): Promise<unknown> {
  const file = await relayFile(path);
  try {
    const size = (await file.stat()).size;
    if (size > maximumBytes) throw new Error("Oversized Relay state");
    const bytes = Buffer.alloc(size + 1);
    let count = 0;
    while (count < bytes.length) {
      const next = await file.read(bytes, count, bytes.length - count, count);
      if (!next.bytesRead) break;
      count += next.bytesRead;
    }
    if (count !== size) throw new Error("Relay state changed while reading");
    const source = bytes.subarray(0, count);
    if (!isUtf8(source)) throw new Error("Invalid Relay metadata encoding");
    return JSON.parse(source.toString("utf8"));
  } finally {
    await file.close();
  }
}

export async function writeRelayState(
  path: string,
  value: unknown,
  previous?: unknown,
  maximumBytes = 16_384,
): Promise<void> {
  const data = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(data) > maximumBytes) throw new Error("Oversized Relay state");
  const verify = async () => {
    if (previous !== undefined) {
      if (!isDeepStrictEqual(await readRelayState(path, maximumBytes), previous))
        throw new Error("Relay metadata changed. Recover the preserved state before retrying.");
    } else {
      const existing = await lstat(path).catch((cause) => {
        if (storageCode(cause) !== "ENOENT") throw cause;
        return null;
      });
      if (existing) throw new Error("Relay metadata already exists. History was preserved.");
    }
  };
  await verify();
  const temporary = join(dirname(path), `${randomUUID()}.tmp`);
  await writePrivateFile(temporary, data, { mode: 0o600, flag: "wx" });
  try {
    await verify();
    await atomicReplace(temporary, path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (storageCode(error) !== "ENOENT") throw error;
    });
  }
}

/** Persistent writer ownership, not a lease. Unknown or inaccessible owners block recovery. */
export async function lockRelay(root: string): Promise<() => Promise<void>> {
  for (const path of [dirname(root), root]) {
    try {
      await verifyRelayStorage(path, true);
    } catch (error) {
      if (storageCode(error) !== "ENOENT") throw error;
      await privateDirectory(path);
      await verifyRelayStorage(path, true);
    }
  }
  const lock = join(root, ".writer");
  const owner = `owner-${process.pid}-${randomUUID()}`;
  for (let attempt = 0; ; attempt++) {
    try {
      await createPrivateDirectory(lock);
      break;
    } catch (error) {
      if (storageCode(error) !== "EEXIST") throw error;
      await verifyRelayStorage(lock, true);
      const entries = await readdir(lock);
      const name = entries[0];
      const match = name && /^owner-([1-9]\d{0,9})-[a-f0-9-]{36}$/.exec(name);
      if (attempt > 1 || entries.length !== 1 || !match)
        throw new Error("Relay writer ownership cannot be verified. History was preserved.");
      await verifyRelayStorage(join(lock, name), false);
      try {
        process.kill(Number(match[1]), 0);
        throw new Error("Relay is already open in another desktop process.");
      } catch (probe) {
        if (storageCode(probe) !== "ESRCH") throw probe;
      }
      // Never remove another reclaimer's newly created owner.
      await unlink(join(lock, name));
      await rmdir(lock);
    }
  }
  try {
    await writePrivateFile(join(lock, owner), "", { mode: 0o600, flag: "wx" });
  } catch (error) {
    await rmdir(lock);
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    await verifyRelayStorage(lock, true);
    await unlink(join(lock, owner));
    await rmdir(lock);
    released = true;
  };
}
