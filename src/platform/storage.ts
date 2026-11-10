import { mkdirSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, rename, writeFile } from "node:fs/promises";
import { helperOutput, helperSync } from "./helper.js";

export async function privateDirectory(path: string): Promise<void> {
  if (process.platform === "win32") await helperOutput(["mkdir-private", path]);
  else await mkdir(path, { recursive: true, mode: 0o700 });
}

/** Creates one private directory exclusively, failing with EEXIST when it already exists.
 * Windows sets the owner explicitly: elevated tokens otherwise default it to Administrators. */
export async function createPrivateDirectory(path: string): Promise<void> {
  if (process.platform === "win32") await helperOutput(["mkdir-private-new", path]);
  else await mkdir(path, { mode: 0o700 });
}

export function privateDirectorySync(path: string): void {
  if (process.platform === "win32") helperSync(["mkdir-private", path]);
  else mkdirSync(path, { recursive: true, mode: 0o700 });
}

export function createPrivateFileSync(path: string): void {
  if (process.platform === "win32") helperSync(["create-private", path]);
  else writeFileSync(path, "", { mode: 0o600, flag: "wx" });
}

export function verifyPrivateSync(path: string): void {
  if (process.platform === "win32") helperSync(["verify-private", path]);
}

export async function writePrivateFile(
  path: string,
  data: string,
  options: { mode: number; flag: "wx" },
): Promise<void> {
  if (process.platform !== "win32") return writeFile(path, data, options);
  await helperOutput(["write-private", path], 1024, 7_000, undefined, data);
}

export async function appendPrivateFile(
  path: string,
  data: string,
  options: { mode: number },
): Promise<void> {
  if (process.platform === "win32")
    await helperOutput(["append-private", path], 1024, 7_000, undefined, data);
  else await appendFile(path, data, options);
}

// Each helper launch needs its own budget; a loaded Windows host can take
// longer than the EBUSY retry window just to start the process.
const REPLACE_ATTEMPT_TIMEOUT_MS = 7_000;

export async function renameFile(
  from: string,
  to: string,
  timeoutMs = REPLACE_ATTEMPT_TIMEOUT_MS,
): Promise<void> {
  if (process.platform === "win32")
    await helperOutput(["replace", from, to], 1024, Math.max(1, timeoutMs));
  else await rename(from, to);
}

/** Native sharing errors are distinct from Node's ambiguous Windows EPERM.
 * Never retry access denial or replace via delete-then-write. */
export async function atomicReplace(
  from: string,
  to: string,
  replace: (from: string, to: string, timeoutMs?: number) => Promise<void> = renameFile,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const deadline = Date.now() + 500;
  let delay = 10;
  let busy: unknown;
  for (;;) {
    if (busy && deadline - Date.now() <= 0) throw busy;
    try {
      // The deadline bounds when a retry may start, not how long one rename attempt runs.
      await replace(from, to, REPLACE_ATTEMPT_TIMEOUT_MS);
      return;
    } catch (error) {
      if (busy && (error as NodeJS.ErrnoException).code === "ETIMEDOUT" && Date.now() >= deadline)
        throw busy;
      if (
        platform !== "win32" ||
        (error as NodeJS.ErrnoException).code !== "EBUSY" ||
        Date.now() + delay > deadline
      )
        throw error;
      busy = error;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 80);
    }
  }
}
