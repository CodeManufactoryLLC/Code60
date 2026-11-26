// Test-only version fixture. These descriptors are not release artifacts or
// evidence for the unexecuted platform. The input payload is never modified.
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { acquirePayload, sha256 } from "./acquire.mjs";
import { writeArchive } from "./archive.mjs";

export async function updateFixture(identity, parent, transport, signal) {
  const staged = await acquirePayload(identity, { parent, transport, signal });
  try {
    const manifest = JSON.parse(await readFile(join(staged.root, "package.json"), "utf8"));
    const [major, minor, patch] = identity.version.split(".").map(Number);
    if (![major, minor, patch].every(Number.isSafeInteger))
      throw Error("Update fixture needs a stable input version");
    const version = `${major}.${minor}.${patch + 1}`;
    manifest.version = version;
    await writeFile(join(staged.root, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const metadata = JSON.parse(await readFile(join(staged.root, "payload.json"), "utf8"));
    const modified = ["package.json"];
    await rm(join(staged.root, "payload.json"));
    metadata.version = version;
    metadata.dirty = false;
    const byPath = new Map(metadata.files.map((entry) => [entry.path, entry]));
    for (const path of modified) {
      const file = join(staged.root, path);
      const existing = byPath.get(path);
      if (existing?.type !== "0")
        throw Error(`Update fixture missing expected inventory entry: ${path}`);
      existing.size = (await stat(file)).size;
      existing.sha256 = await sha256(file, signal);
    }
    await writeFile(join(staged.root, "payload.json"), `${JSON.stringify(metadata, null, 2)}\n`);
    const name = `code60-${version}-${identity.os}-${identity.arch}.tar.gz`;
    const archive = join(parent, name);
    await writeArchive(staged.root, archive, { signal, level: 1 });
    const descriptor = {
      ...identity,
      version,
      dirty: false,
      archive: {
        name,
        size: (await stat(archive)).size,
        sha256: await sha256(archive, signal),
        url: `https://github.com/CodeManufactoryLLC/Code60/releases/download/v${version}/${name}`,
      },
    };
    const other =
      identity.os === "linux" ? { os: "darwin", arch: "arm64" } : { os: "linux", arch: "x64" };
    const otherName = `code60-${version}-${other.os}-${other.arch}.tar.gz`;
    const platforms = {
      [`${identity.os}-${identity.arch}`]: descriptor,
      [`${other.os}-${other.arch}`]: {
        ...descriptor,
        ...other,
        runtime: { ...identity.runtime, libc: other.os === "linux" ? "glibc" : null },
        archive: {
          ...descriptor.archive,
          name: otherName,
          url: `https://github.com/CodeManufactoryLLC/Code60/releases/download/v${version}/${otherName}`,
        },
      },
    };
    const source = join(parent, "registry-source");
    const root = join(source, "package");
    await mkdir(join(root, "bin"), { recursive: true });
    await mkdir(join(root, "lib"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "code60",
        version,
        type: "module",
        private: true,
        engines: { node: ">=24.22.0 <25" },
        bin: { code60: "bin/code60.mjs" },
      }),
    );
    await writeFile(join(root, "platforms.json"), JSON.stringify(platforms));
    for (const file of ["bin/code60.mjs", "lib/index.mjs"])
      await writeFile(
        join(root, file),
        'throw Error("Acceptance must never execute the registry bootstrap");\n',
      );
    for (const file of ["LICENSE", "NOTICE", "TRADEMARKS.md"])
      await writeFile(
        join(root, file),
        "Synthetic acceptance fixture; not a distributable release\n",
      );
    const bootstrap = join(parent, "bootstrap.tgz");
    await writeArchive(source, bootstrap, { signal, level: 1 });
    const bytes = await readFile(bootstrap);
    const registry = {
      name: "code60",
      version,
      dist: {
        tarball: `https://registry.npmjs.org/code60/-/code60-${version}.tgz`,
        integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      },
    };
    return {
      descriptor,
      archive,
      bootstrap,
      registry,
      synthetic: true,
      original: identity,
    };
  } finally {
    await rm(staged.owned, { recursive: true });
  }
}
