import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
  symlink,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const installationFileCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code;
export interface FileIdentity {
  dev: string;
  ino: string;
  mode: number;
  size: number;
  hash: string;
}
const uid = () => process.getuid?.() ?? -1;
export function absoluteInstallationPath(path: string) {
  if (!isAbsolute(path) || /[\0\r\n]/.test(path))
    throw new Error("Installation paths must be safe absolute paths");
  return resolve(path);
}
export async function installationDirectory(
  path: string,
  create = false,
  privateMode = false,
): Promise<void> {
  path = absoluteInstallationPath(path);
  if (path === "/") return;
  await installationDirectory(dirname(path), false);
  let info = await lstat(path).catch((error: unknown) => {
    if (installationFileCode(error) !== "ENOENT") throw error;
    return null;
  });
  if (!info && create) {
    const parent = await lstat(dirname(path));
    if (parent.uid !== uid())
      throw new Error("Refusing to write a root-owned or foreign directory");
    await mkdir(path, { mode: privateMode ? 0o700 : 0o755 }).catch((error: unknown) => {
      if (installationFileCode(error) !== "EEXIST") throw error;
    });
    info = await lstat(path);
  }
  if (
    !info?.isDirectory() ||
    info.isSymbolicLink() ||
    ((info.mode & 0o022) !== 0 && !(info.mode & 0o1000))
  )
    throw new Error("Unsafe installation directory");
  if (privateMode && (info.uid !== uid() || info.mode & 0o077))
    throw new Error("Unsafe private installation permissions");
}
export async function createInstallationParents(path: string, privateMode = false) {
  const full = absoluteInstallationPath(path);
  const missing: string[] = [];
  let current = full;
  while (
    !(await lstat(current).catch((error: unknown) => {
      if (installationFileCode(error) !== "ENOENT") throw error;
      return null;
    }))
  ) {
    missing.push(current);
    current = dirname(current);
  }
  await installationDirectory(current);
  for (const directory of missing.reverse())
    await installationDirectory(directory, true, privateMode);
  await installationDirectory(full, false, privateMode);
}
export async function installationSnapshot(
  path: string,
  maximum = 1024 * 1024,
  privateMode = false,
): Promise<{ text: string; identity: FileIdentity } | null> {
  await installationDirectory(dirname(path));
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  ).catch((error: unknown) => {
    if (installationFileCode(error) === "ENOENT") return null;
    if (installationFileCode(error) === "ELOOP") throw new Error("Unsafe installation file link");
    throw error;
  });
  if (!file) return null;
  try {
    const start = await file.stat({ bigint: true });
    if (
      !start.isFile() ||
      start.nlink !== 1n ||
      start.uid !== BigInt(uid()) ||
      start.size > BigInt(maximum) ||
      start.mode & 0o7022n ||
      (privateMode && start.mode & 0o077n)
    )
      throw new Error("Unsafe installation file ownership, size or permissions");
    const bytes = Buffer.alloc(Number(start.size) + 1);
    let size = 0;
    while (size < bytes.length) {
      const part = await file.read(bytes, size, bytes.length - size, size);
      if (!part.bytesRead) break;
      size += part.bytesRead;
    }
    const after = await file.stat({ bigint: true });
    const entry = await lstat(path, { bigint: true });
    if (
      size !== Number(start.size) ||
      after.ctimeNs !== start.ctimeNs ||
      after.mtimeNs !== start.mtimeNs ||
      entry.dev !== start.dev ||
      entry.ino !== start.ino
    )
      throw new Error("Installation file changed");
    const data = bytes.subarray(0, size);
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
    return {
      text,
      identity: {
        dev: String(start.dev),
        ino: String(start.ino),
        mode: Number(start.mode) & 0o777,
        size,
        hash: createHash("sha256").update(data).digest("hex"),
      },
    };
  } finally {
    await file.close();
  }
}
export async function writeInstallationFile(
  path: string,
  text: string,
  previous: FileIdentity | null,
  mode = 0o600,
) {
  await installationDirectory(dirname(path));
  if ((await lstat(dirname(path))).uid !== uid())
    throw new Error("Refusing to edit a foreign directory");
  const verify = async () => {
    const actual = await installationSnapshot(path);
    if (JSON.stringify(actual?.identity ?? null) !== JSON.stringify(previous))
      throw new Error("Installation file changed since preview");
  };
  await verify();
  const temporary = join(dirname(path), `.code60-${randomUUID()}.tmp`);
  try {
    const file = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      mode,
    );
    try {
      await file.chmod(mode);
      await file.writeFile(text);
      await file.sync();
    } finally {
      await file.close();
    }
    await verify();
    await rename(temporary, path);
    await syncInstallationDirectory(dirname(path));
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (installationFileCode(error) !== "ENOENT") throw error;
    });
  }
  return (await installationSnapshot(path))?.identity as FileIdentity;
}
export async function syncInstallationDirectory(path: string) {
  const file = await open(path, constants.O_RDONLY);
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}
export async function installationLink(path: string): Promise<string | null> {
  await installationDirectory(dirname(path));
  const info = await lstat(path).catch((error: unknown) => {
    if (installationFileCode(error) !== "ENOENT") throw error;
    return null;
  });
  if (!info) return null;
  if (!info.isSymbolicLink() || info.uid !== uid()) throw new Error("Unowned installation link");
  return readlink(path);
}
export async function publishInstallationLink(
  path: string,
  target: string,
  expected: string | null,
) {
  await installationDirectory(dirname(path), false, true);
  if (
    isAbsolute(target) ||
    target.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Unsafe activation link target");
  if ((await installationLink(path)) !== expected)
    throw new Error("Activation changed outside its owner");
  const temporary = join(dirname(path), `.current-${randomUUID()}`);
  try {
    await symlink(target, temporary);
    if ((await installationLink(path)) !== expected)
      throw new Error("Activation changed outside its owner");
    await rename(temporary, path);
    await syncInstallationDirectory(dirname(path));
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (installationFileCode(error) !== "ENOENT") throw error;
    });
  }
}
export async function lockInstallation(root: string, kind: "install" | "setup" = "install") {
  await installationDirectory(root, false, true);
  const path = join(root, kind === "setup" ? ".setup-lock" : ".install-lock");
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (installationFileCode(error) === "EEXIST")
      throw new Error(
        `Installation ownership is busy or uncertain: ${path}. Preserve it; see installation recovery guidance.`,
      );
    throw error;
  }
  const token = randomUUID();
  const owner = join(path, "owner.json");
  const info = await lstat(path, { bigint: true });
  try {
    await writeInstallationFile(owner, JSON.stringify({ token, pid: process.pid }), null);
  } catch (error) {
    await rmdir(path);
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    await installationDirectory(path, false, true);
    const current = await lstat(path, { bigint: true });
    const record = await installationSnapshot(owner, 4096, true);
    if (
      current.dev !== info.dev ||
      current.ino !== info.ino ||
      !record ||
      JSON.parse(record.text).token !== token
    )
      throw new Error("Installation lock ownership changed; preserved lock");
    await unlink(owner);
    await rmdir(path);
    released = true;
  };
}
export async function verifyInstallationNode(path = process.execPath) {
  const canonical = await realpath(path);
  const info = await lstat(canonical);
  if (!info.isFile() || ![0, uid()].includes(info.uid) || info.mode & 0o022 || !(info.mode & 0o111))
    throw new Error("Unsafe Node executable");
  return canonical;
}
export async function removeInstallationTree(path: string, identity: { dev: string; ino: string }) {
  const info = await lstat(path, { bigint: true });
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== BigInt(uid()) ||
    String(info.dev) !== identity.dev ||
    String(info.ino) !== identity.ino
  )
    throw new Error("Installation cleanup ownership changed");
  await rm(path, { recursive: true });
}
export async function installationTreeIdentity(path: string) {
  await installationDirectory(path, false, true);
  const info = await lstat(path, { bigint: true });
  return { dev: String(info.dev), ino: String(info.ino) };
}
export async function executableInstallationFile(path: string, contents: string) {
  await writeInstallationFile(path, contents, null);
  await chmod(path, 0o700);
}
export async function exclusiveInstallationLink(path: string, target: string) {
  await installationDirectory(dirname(path));
  if ((await lstat(dirname(path))).uid !== uid())
    throw new Error("Refusing to write a foreign launcher directory");
  await symlink(target, path);
  await syncInstallationDirectory(dirname(path));
}

export async function removeOwnedInstallationFile(
  path: string,
  identity: { dev: bigint; ino: bigint },
) {
  const current = await lstat(path, { bigint: true });
  if (
    !current.isFile() ||
    current.uid !== BigInt(uid()) ||
    current.dev !== identity.dev ||
    current.ino !== identity.ino
  )
    throw Error("Staging ownership changed; preserved uncertain file");
  await unlink(path);
}
