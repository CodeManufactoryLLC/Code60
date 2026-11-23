import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";

await rm(new URL("../dist/", import.meta.url), { recursive: true, force: true });
for (const args of [
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"],
  ["node_modules/vite/bin/vite.js", "build"],
]) {
  execFileSync(process.execPath, args, { stdio: "inherit", timeout: 120_000 });
}
