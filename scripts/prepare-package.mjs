import { execFileSync } from "node:child_process";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const output = "release/licenses";
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
async function notices(directory, base, target) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") await notices(path, base, target);
    else if (
      entry.isFile() &&
      /^(licen[cs]e|notice|copying|ofl)(\.|$)|upstream-license/i.test(entry.name)
    ) {
      const destination = join(output, target, relative(base, path));
      await mkdir(join(destination, ".."), { recursive: true });
      await cp(path, destination);
    }
  }
}
await notices("src/renderer/fonts", "src", "vendored");
await notices("src/renderer/icons", "src", "vendored");
// Include only production dependency notices; development tooling is not shipped.
const dependencies = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], {
  encoding: "utf8",
  timeout: 60_000,
});
for (const directory of new Set(dependencies.trim().split("\n").slice(1))) {
  await notices(directory, resolve("node_modules"), "dependencies");
}
