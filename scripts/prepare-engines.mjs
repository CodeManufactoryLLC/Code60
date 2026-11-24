import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanBuild } from "./clean-build.mjs";
import { runCommand } from "./distribution/command.mjs";
import { buildTransmission } from "./distribution/transmission.mjs";

await runCommand(async (signal) => {
  if (process.argv.length !== 2)
    throw Error("Use npm run prepare:engines on a supported native target after building Code60");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const output = join(root, "dist/engines");
  await cleanBuild(output);
  const manifest = await buildTransmission(root, output, { signal });
  console.log(`Prepared pinned Transmission bundle ${manifest.lockfileSha256}`);
});
