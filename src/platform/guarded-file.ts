import { createHash, randomUUID } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import * as fs from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type GuardedFileIo = Pick<
  typeof fs,
  "lstat" | "realpath" | "open" | "mkdir" | "rename" | "unlink"
> & {
  checkpoint?: (step: "stage" | "rename" | "directory-sync", target: string) => Promise<void>;
};
export interface GuardedRoot {
  path: string;
  device: string;
  inode: string;
}
export interface GuardedTarget {
  root: GuardedRoot;
  relative: string;
  private: boolean;
  mode: number;
}
interface GuardedIdentity {
  device: string;
  inode: string;
  size: string;
  mtime: string;
  ctime: string;
  mode: number;
}
export interface GuardedSnapshot {
  data: Uint8Array | null;
  revision: string;
  identity: GuardedIdentity | null;
  mode: number;
}
export interface GuardedStage {
  name: string;
  identity: GuardedIdentity;
  digest: string;
}
export class GuardedFileError extends Error {
  constructor(readonly code: "unsafe" | "changed" | "too-large" | "read-only") {
    super(`Configuration storage ${code}`);
  }
}
const hash = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
export function guardedFileRevision(
  target: GuardedTarget,
  value: Pick<GuardedSnapshot, "data" | "identity">,
): string {
  const path = join(target.root.path, target.relative);
  return value.data === null
    ? hash(`${path}:missing`)
    : hash(`${path}:${JSON.stringify(value.identity)}:${hash(value.data)}`);
}
const owned = (info: { uid: bigint; mode: bigint }) =>
  info.uid === BigInt(process.getuid?.() ?? -1) && (info.mode & 0o022n) === 0n;
const identity = (info: BigIntStats): GuardedIdentity => ({
  device: String(info.dev),
  inode: String(info.ino),
  size: String(info.size),
  mtime: String(info.mtimeNs),
  ctime: String(info.ctimeNs),
  mode: Number(info.mode & 0o777n),
});

export async function captureGuardedRoot(
  path: string,
  io: GuardedFileIo = fs,
): Promise<GuardedRoot> {
  const canonical = await io.realpath(path);
  const info = await io.lstat(path, { bigint: true });
  if (resolve(path) !== canonical || !info.isDirectory() || info.isSymbolicLink() || !owned(info))
    throw new GuardedFileError("unsafe");
  return { path: canonical, device: String(info.dev), inode: String(info.ino) };
}

/** Missing configuration directories are anchored at their nearest existing trusted parent. */
export async function bindGuardedTarget(
  directory: string,
  privateFile: boolean,
  io: GuardedFileIo = fs,
): Promise<GuardedTarget> {
  const desired = resolve(directory);
  let anchor = desired;
  for (;;) {
    try {
      const root = await captureGuardedRoot(anchor, io);
      return {
        root,
        relative: relative(anchor, join(desired, "mcp.json")),
        private: privateFile,
        mode: privateFile ? 0o600 : 0o644,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(anchor) === anchor)
        throw error;
      anchor = dirname(anchor);
    }
  }
}

async function verifyGuardedTarget(
  target: GuardedTarget,
  create = false,
  io: GuardedFileIo = fs,
): Promise<string> {
  const root = await captureGuardedRoot(target.root.path, io);
  if (root.device !== target.root.device || root.inode !== target.root.inode)
    throw new GuardedFileError("changed");
  const parts = target.relative.split(sep);
  if (
    isAbsolute(target.relative) ||
    parts.some((part) => !part || part === "." || part === "..") ||
    parts.at(-1) !== "mcp.json"
  )
    throw new GuardedFileError("unsafe");
  let directory = root.path;
  for (const part of parts.slice(0, -1)) {
    directory = join(directory, part);
    try {
      const info = await io.lstat(directory, { bigint: true });
      if (!info.isDirectory() || info.isSymbolicLink() || !owned(info))
        throw new GuardedFileError("unsafe");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (create) {
        await io.mkdir(directory, { mode: target.private ? 0o700 : 0o755 });
        const info = await io.lstat(directory, { bigint: true });
        if (!info.isDirectory() || info.isSymbolicLink() || !owned(info))
          throw new GuardedFileError("unsafe");
      }
    }
  }
  return join(root.path, target.relative);
}

export async function readGuardedFile(
  target: GuardedTarget,
  maximumBytes: number,
  io: GuardedFileIo = fs,
): Promise<GuardedSnapshot> {
  const path = await verifyGuardedTarget(target, false, io);
  let file: fs.FileHandle;
  try {
    file = await io.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      await io.lstat(path);
    } catch (missing) {
      if ((missing as NodeJS.ErrnoException).code === "ENOENT")
        return {
          data: null,
          identity: null,
          revision: guardedFileRevision(target, { data: null, identity: null }),
          mode: target.mode,
        };
      throw missing;
    }
    throw new GuardedFileError("changed");
  }
  try {
    const start = await file.stat({ bigint: true });
    if (
      !start.isFile() ||
      start.nlink !== 1n ||
      !owned(start) ||
      (target.private && (start.mode & 0o077n) !== 0n)
    )
      throw new GuardedFileError("unsafe");
    if (start.size > BigInt(maximumBytes)) throw new GuardedFileError("too-large");
    const data = Buffer.alloc(Number(start.size) + 1);
    let count = 0;
    while (count < data.length) {
      const { bytesRead } = await file.read(data, count, data.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
    }
    await verifyGuardedTarget(target, false, io);
    const end = await file.stat({ bigint: true });
    const entry = await io.lstat(path, { bigint: true });
    if (
      count !== Number(start.size) ||
      entry.isSymbolicLink() ||
      entry.nlink !== 1n ||
      !owned(entry) ||
      JSON.stringify(identity(start)) !== JSON.stringify(identity(end)) ||
      JSON.stringify(identity(end)) !== JSON.stringify(identity(entry))
    )
      throw new GuardedFileError("changed");
    const bytes = data.subarray(0, count);
    const stamp = identity(start);
    return {
      data: bytes,
      identity: stamp,
      mode: stamp.mode,
      revision: guardedFileRevision(target, { data: bytes, identity: stamp }),
    };
  } finally {
    await file.close();
  }
}

export async function stageGuardedFile(
  target: GuardedTarget,
  data: Uint8Array,
  mode: number,
  io: GuardedFileIo = fs,
): Promise<GuardedStage> {
  const path = await verifyGuardedTarget(target, true, io);
  await io.checkpoint?.("stage", path);
  const name = `.code60-mcp-${randomUUID()}.tmp`;
  const temporary = join(dirname(path), name);
  const handle = await io.open(temporary, "wx", mode);
  try {
    await handle.writeFile(data);
    await handle.chmod(mode);
    await handle.sync();
    return { name, identity: identity(await handle.stat({ bigint: true })), digest: hash(data) };
  } catch (error) {
    const entry = await io.lstat(temporary, { bigint: true });
    const current = await handle.stat({ bigint: true });
    if (
      entry.isFile() &&
      entry.nlink === 1n &&
      entry.dev === current.dev &&
      entry.ino === current.ino
    )
      await io.unlink(temporary);
    throw error;
  } finally {
    await handle.close();
  }
}

/** Checks a prepared sibling without following links; never removes a foreign temporary. */
export async function discardGuardedStage(
  target: GuardedTarget,
  stage: GuardedStage,
  io: GuardedFileIo = fs,
): Promise<void> {
  const path = await verifyGuardedTarget(target, false, io);
  if (!/^\.code60-mcp-[a-f0-9-]{36}\.tmp$/.test(stage.name) || basename(stage.name) !== stage.name)
    throw new GuardedFileError("unsafe");
  const temporary = join(dirname(path), stage.name);
  try {
    const current = await io.lstat(temporary, { bigint: true });
    if (
      !current.isFile() ||
      current.nlink !== 1n ||
      JSON.stringify(identity(current)) !== JSON.stringify(stage.identity) ||
      !owned(current)
    )
      throw new GuardedFileError("changed");
    await io.unlink(temporary);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function publishGuardedFile(
  target: GuardedTarget,
  expectedRevision: string,
  stage: GuardedStage | null,
  maximumBytes: number,
  io: GuardedFileIo = fs,
  signal?: AbortSignal,
): Promise<GuardedSnapshot> {
  const before = await readGuardedFile(target, maximumBytes, io);
  if (before.revision !== expectedRevision) throw new GuardedFileError("changed");
  if (before.identity && (before.mode & 0o200) === 0) throw new GuardedFileError("read-only");
  const path = await verifyGuardedTarget(target, false, io);
  if (stage) {
    if (!/^\.code60-mcp-[a-f0-9-]{36}\.tmp$/.test(stage.name)) throw new GuardedFileError("unsafe");
    const temporary = join(dirname(path), stage.name);
    const info = await io.lstat(temporary, { bigint: true });
    if (
      !info.isFile() ||
      info.nlink !== 1n ||
      !owned(info) ||
      JSON.stringify(identity(info)) !== JSON.stringify(stage.identity)
    )
      throw new GuardedFileError("changed");
    const handle = await io.open(
      temporary,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const start = await handle.stat({ bigint: true });
      if (
        start.size > BigInt(maximumBytes) ||
        JSON.stringify(identity(start)) !== JSON.stringify(stage.identity)
      )
        throw new GuardedFileError("changed");
      const data = Buffer.alloc(Number(start.size) + 1);
      let count = 0;
      while (count < data.length) {
        const { bytesRead } = await handle.read(data, count, data.length - count, count);
        if (!bytesRead) break;
        count += bytesRead;
      }
      if (
        count !== Number(start.size) ||
        hash(data.subarray(0, count)) !== stage.digest ||
        JSON.stringify(identity(await handle.stat({ bigint: true }))) !==
          JSON.stringify(stage.identity)
      )
        throw new GuardedFileError("changed");
    } finally {
      await handle.close();
    }
    await io.checkpoint?.("rename", path);
    if ((await readGuardedFile(target, maximumBytes, io)).revision !== expectedRevision)
      throw new GuardedFileError("changed");
    if (
      JSON.stringify(identity(await io.lstat(temporary, { bigint: true }))) !==
      JSON.stringify(stage.identity)
    )
      throw new GuardedFileError("changed");
    signal?.throwIfAborted();
    await io.rename(temporary, path);
  } else if (before.data !== null) {
    signal?.throwIfAborted();
    await io.unlink(path);
  }
  await syncGuardedDirectory(target, io);
  const after = await readGuardedFile(target, maximumBytes, io);
  if (
    stage &&
    (after.identity?.inode !== stage.identity.inode ||
      after.identity.device !== stage.identity.device ||
      after.data === null ||
      hash(after.data) !== stage.digest)
  )
    throw new GuardedFileError("changed");
  return after;
}

/** Also used to settle a rename whose directory sync was interrupted, without replaying it. */
export async function syncGuardedDirectory(
  target: GuardedTarget,
  io: GuardedFileIo = fs,
): Promise<void> {
  const path = await verifyGuardedTarget(target, false, io);
  await io.checkpoint?.("directory-sync", path);
  let parent = dirname(path);
  for (;;) {
    try {
      const handle = await io.open(parent, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || parent === target.root.path)
        throw error;
      parent = dirname(parent);
    }
  }
}
