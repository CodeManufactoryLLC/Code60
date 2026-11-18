import { homedir } from "node:os";
import { posix } from "node:path";

export function environmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return env[name];
}

export function setEnvironmentPath(env: NodeJS.ProcessEnv, path: string): void {
  env.PATH = path;
}

export function userHome(env: NodeJS.ProcessEnv): string {
  return env.HOME || homedir();
}

export function mergeSearchPath(entries: readonly string[]): string {
  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      if (!entry || entry.includes("\0") || !posix.isAbsolute(entry)) return false;
      const key = posix.normalize(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => posix.normalize(entry))
    .join(":");
}
