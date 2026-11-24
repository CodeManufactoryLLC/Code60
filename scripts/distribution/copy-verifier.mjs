import { cp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Explicit source inventory: host tooling and both compiled distributions share
// the verifier without depending on a pre-existing development build.
export async function copyPayloadVerifier(output) {
  const source = fileURLToPath(new URL("../../src/platform/", import.meta.url));
  for (const name of ["payload-descriptor.mjs", "payload-archive.mjs", "payload-acquire.mjs"])
    await cp(join(source, name), join(output, "platform", name));
}

export async function writeBootstrapVerifier(library) {
  for (const name of ["acquire.mjs", "archive.mjs", "descriptor.mjs"])
    await writeFile(join(library, name), `export * from "./runtime/platform/payload-${name}";\n`);
}
