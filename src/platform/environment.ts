import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export function environmentValue(
  env: NodeJS.ProcessEnv,
  name: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform !== "win32") return env[name];
  const key = Object.keys(env)
    .sort()
    .find((key) => key.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

export function setEnvironmentPath(env: NodeJS.ProcessEnv, path: string): void {
  if (process.platform === "win32") {
    for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
  }
  env.PATH = path;
}

export function userHome(env: NodeJS.ProcessEnv): string {
  return (
    environmentValue(env, "HOME") ||
    (process.platform === "win32" ? environmentValue(env, "USERPROFILE") : undefined) ||
    homedir()
  );
}

export function mergeSearchPath(
  entries: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string {
  const paths = platform === "win32" ? win32 : posix;
  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      if (!entry || entry.includes("\0") || !paths.isAbsolute(entry)) return false;
      if (platform === "win32" && (!/^[a-z]:[\\/]/i.test(entry) || entry.includes('"')))
        return false;
      const key = paths.normalize(entry);
      // Do not globally lowercase paths: case-sensitive Windows directories exist.
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => paths.normalize(entry))
    .join(platform === "win32" ? ";" : ":");
}
