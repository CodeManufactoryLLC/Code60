import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const installer = require.resolve("electron/install.js");
const { version } = require("electron/package.json");

/** Retry only an upstream server error; Electron still verifies its bundled checksums. */
export function installElectron(run = spawnSync, env = process.env, report = console.error) {
  const filename = `electron-v${version}-${process.platform}-${process.arch}.zip`;
  const official = `https://github.com/electron/electron/releases/download/v${version}/${filename}`;
  for (const retry of [false, true]) {
    const result = run(process.execPath, [installer], {
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...env,
        // Always use the digests shipped in the locked Electron npm package.
        electron_use_remote_checksums: "",
        npm_config_electron_use_remote_checksums: "",
        ...(retry ? { ELECTRON_CUSTOM_FILENAME: `${filename}?download=1` } : {}),
      },
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (output) report(output);
    if (result.error) throw result.error;
    if (result.status === 0) return;
    if (retry || !output.includes(official) || !/Response code 5\d\d\b/.test(output))
      throw new Error("Electron installation failed");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  installElectron();
