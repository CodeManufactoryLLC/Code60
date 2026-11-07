import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { helperOutput, helperSync } from "./helper.js";

export async function privateDirectory(path: string): Promise<void> {
  if (process.platform === "win32") await helperOutput(["mkdir-private", path]);
  else await mkdir(path, { recursive: true, mode: 0o700 });
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

export async function renameFile(from: string, to: string, timeoutMs = 500): Promise<void> {
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
    const remaining = deadline - Date.now();
    if (busy && remaining <= 0) throw busy;
    try {
      await replace(from, to, Math.max(1, remaining));
      return;
    } catch (error) {
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
