import { execFileSync } from "node:child_process";
import { readdir, readFile, rename } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { cleanBuild } from "./clean-build.mjs";

const output = resolve("build/distribution");
await cleanBuild(output);
execFileSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "-p", "tsconfig.distribution.json"],
  { stdio: "inherit", timeout: 120000 },
);
// Preserve the public index.js import while selecting the Node-only platform facade.
await rename(join(output, "platform/index.bootstrap.js"), join(output, "platform/index.js"));
for (const item of await readdir(output, { recursive: true, withFileTypes: true })) {
  if (!item.isFile()) continue;
  const path = join(item.parentPath, item.name);
  const local = relative(output, path).replaceAll("\\", "/");
  if (!/^(management|platform)\/[a-z-]+\.(?:js|mjs)$/.test(local))
    throw Error("Distribution build escaped its Node-only module closure");
  const text = await readFile(path, "utf8");
  for (const match of text.matchAll(/(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g)) {
    const spec = match[1];
    if (isBuiltin(spec)) continue;
    if (!spec.startsWith(".") || !resolve(dirname(path), spec).startsWith(`${output}/`))
      throw Error("Distribution build imported an application or third-party dependency");
  }
}
console.log("Verified Node-only distribution build closure.");
