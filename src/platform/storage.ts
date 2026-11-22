import { lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";

export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
}

/** Create exclusively; never replace an existing directory. */
export async function createPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700 });
}

export function privateDirectorySync(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

export function createPrivateFileSync(path: string): void {
  writeFileSync(path, "", { mode: 0o600, flag: "wx" });
}

export function verifyPrivateSync(path: string): void {
  const info = lstatSync(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    (info.mode & 0o077) !== 0 ||
    info.uid !== process.getuid?.()
  )
    throw new Error("Unsafe private storage permissions");
}

export async function writePrivateFile(
  path: string,
  data: string,
  options: { mode: number; flag: "wx" },
): Promise<void> {
  await writeFile(path, data, options);
}

export async function appendPrivateFile(
  path: string,
  data: string,
  options: { mode: number },
): Promise<void> {
  await appendFile(path, data, options);
}

export async function renameFile(from: string, to: string): Promise<void> {
  await rename(from, to);
}

/** Replace atomically; never delete the destination before renaming. */
export async function atomicReplace(
  from: string,
  to: string,
  replace: (from: string, to: string, timeoutMs?: number) => Promise<void> = renameFile,
): Promise<void> {
  await replace(from, to);
}
