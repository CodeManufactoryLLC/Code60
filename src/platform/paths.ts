import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Resolve real filesystem spelling without assuming all Windows folders ignore case. */
export async function canonicalPath(path: string): Promise<string> {
  return realpath(resolve(path));
}

export async function samePath(left: string, right: string): Promise<boolean> {
  if (resolve(left) === resolve(right)) return true;
  try {
    return (await canonicalPath(left)) === (await canonicalPath(right));
  } catch {
    return false;
  }
}

export function containedPath(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return !isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`);
}
