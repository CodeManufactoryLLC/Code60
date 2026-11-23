import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cleanBuild } from "./clean-build.mjs";

await cleanBuild(fileURLToPath(new URL("../dist/", import.meta.url)));
for (const args of [
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"],
  ["node_modules/vite/bin/vite.js", "build"],
]) {
  execFileSync(process.execPath, args, { stdio: "inherit", timeout: 120_000 });
}
