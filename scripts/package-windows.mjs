import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") throw new Error("Build Windows installers on Windows");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm =
  process.env.npm_execpath || join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
if (!existsSync(npm) || !npm.endsWith("npm-cli.js")) throw new Error("Run packaging through npm");
for (const args of [
  [npm, "run", "build"],
  ["scripts/prepare-package.mjs"],
  [
    "node_modules/electron-builder/cli.js",
    "--config",
    "scripts/packaging-config.cjs",
    "--win",
    "--x64",
    "--publish",
    "never",
  ],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, CODE60_HELPER_ARCH: "x64" },
    stdio: "inherit",
    windowsHide: true,
    timeout: 15 * 60_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
