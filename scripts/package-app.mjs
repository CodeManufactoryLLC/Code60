import { execFileSync } from "node:child_process";
import { resolveCommand } from "../dist/platform/index.js";

const command = await resolveCommand([
  "npm",
  "pack",
  "--json",
  "--pack-destination",
  "release/build",
]);
const result = JSON.parse(
  execFileSync(command.file, command.args, {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  }),
);
for (const archive of result)
  process.stdout.write(`${archive.filename}: ${archive.entryCount} files, ${archive.size} bytes\n`);
