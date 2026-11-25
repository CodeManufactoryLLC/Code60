import { execFileSync } from "node:child_process";
import { cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cleanBuild } from "./clean-build.mjs";

await cleanBuild(fileURLToPath(new URL("../dist/", import.meta.url)));
for (const args of [
  ["scripts/build-pty-helper.mjs"],
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"],
  ["node_modules/vite/bin/vite.js", "build"],
]) {
  execFileSync(process.execPath, args, { stdio: "inherit", timeout: 120_000 });
}

// Installed updates must copy the same verified Node-only support used by bootstrap setup.
execFileSync(process.execPath, ["scripts/build-distribution.mjs"], {
  stdio: "inherit",
  timeout: 120_000,
});
await cp(
  fileURLToPath(new URL("../build/distribution/", import.meta.url)),
  fileURLToPath(new URL("../dist/bootstrap/", import.meta.url)),
  { recursive: true },
);
