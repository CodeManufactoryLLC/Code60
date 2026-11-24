import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sha256 } from "./distribution/acquire.mjs";
import { bootstrapAdapter } from "./distribution/bootstrap-adapter.mjs";
import { runCommand } from "./distribution/command.mjs";
import { writeBootstrapVerifier } from "./distribution/copy-verifier.mjs";
import { descriptorPair, nodeRange, targets } from "./distribution/descriptor.mjs";

const execute = promisify(execFile);
export async function packageBootstrap(root, input, { signal } = {}) {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const names = (await readdir(input)).filter((name) => name.endsWith(".json"));
  if (JSON.stringify(names.sort()) !== JSON.stringify(targets.map((name) => `${name}.json`).sort()))
    throw new Error("Supply exactly both platform descriptors");
  const values = await Promise.all(
    names.map(async (name) => JSON.parse(await readFile(join(input, name), "utf8"))),
  );
  const platforms = descriptorPair(values, manifest.version);
  for (const value of values) {
    const archive = join(input, value.archive.name);
    if (
      (await stat(archive)).size !== value.archive.size ||
      (await sha256(archive)) !== value.archive.sha256
    )
      throw new Error("Bootstrap input archive checksum mismatch");
  }
  const temporary = await mkdtemp(join(tmpdir(), "code60-bootstrap-"));
  const output = join(root, "release/bootstrap");
  try {
    await mkdir(join(temporary, "bin"));
    await mkdir(join(temporary, "lib"));
    await mkdir(output, { recursive: true });
    await writeFile(
      join(temporary, "package.json"),
      `${JSON.stringify(
        {
          name: manifest.name,
          version: manifest.version,
          private: true,
          type: "module",
          description: "Code60 verified distribution bootstrap",
          license: manifest.license,
          engines: { node: nodeRange },
          os: ["darwin", "linux"],
          bin: { code60: "bin/code60.mjs" },
          files: ["bin", "lib", "platforms.json", "LICENSE", "NOTICE", "TRADEMARKS.md"],
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(join(temporary, "platforms.json"), `${JSON.stringify(platforms, null, 2)}\n`);
    await cp(join(root, "scripts/distribution/bootstrap.mjs"), join(temporary, "bin/code60.mjs"));
    await writeBootstrapVerifier(join(temporary, "lib"));
    await cp(join(root, "build/distribution"), join(temporary, "lib/runtime"), { recursive: true });
    await writeFile(join(temporary, "lib/index.mjs"), bootstrapAdapter);
    for (const name of ["LICENSE", "NOTICE", "TRADEMARKS.md"])
      await cp(join(root, name), join(temporary, name));
    const { stdout } = await execute(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", output],
      { cwd: temporary, signal, timeout: 30_000, maxBuffer: 1024 ** 2 },
    );
    const [archive] = JSON.parse(stdout);
    if ((await stat(join(output, archive.filename))).size >= 1024 ** 2)
      throw new Error("Bootstrap exceeds 1 MiB limit");
    console.log(`Bootstrap built: ${join(output, archive.filename)}`);
    return join(output, archive.filename);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCommand(async (signal) => {
    if (process.argv.length !== 3)
      throw new Error("Use npm run package:bootstrap -- <descriptor-directory>");
    await packageBootstrap(
      fileURLToPath(new URL("..", import.meta.url)),
      resolve(process.argv[2]),
      { signal },
    );
  });
}
