import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { writeArchive } from "./payload-archive.mjs";
import type { PayloadDescriptor } from "./payload-descriptor.mjs";
import { newerStableRelease, readStableBootstrap, registryTransport } from "./update-registry.js";

const directories: string[] = [];
const registry = "https://registry.npmjs.org/code60";
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const root of directories.splice(0)) await rm(root, { recursive: true, force: true });
});
async function temporary() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "code60 registry spaces ' ")));
  directories.push(root);
  return root;
}
function descriptor(os: "darwin" | "linux", arch: "arm64" | "x64"): PayloadDescriptor {
  const name = `code60-0.5.0-${os}-${arch}.tar.gz`;
  return {
    schemaVersion: 1,
    version: "0.5.0",
    commit: "a".repeat(40),
    dirty: false,
    os,
    arch,
    runtime: { node: ">=24.22.0 <25", libc: os === "linux" ? "glibc" : null },
    archive: {
      name,
      size: 100,
      sha256: "b".repeat(64),
      url: `https://github.com/CodeManufactoryLLC/Code60/releases/download/v0.5.0/${name}`,
    },
  };
}
async function fixture() {
  const parent = await temporary();
  const source = join(parent, "source");
  const packageRoot = join(source, "package");
  await mkdir(join(packageRoot, "bin"), { recursive: true });
  await mkdir(join(packageRoot, "lib"));
  const executed = join(parent, "must-not-execute");
  const malicious = `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(executed)}, "executed"); throw Error("downloaded code executed");`;
  for (const name of ["bin/code60.mjs", "lib/index.mjs"])
    await writeFile(join(packageRoot, name), malicious);
  for (const name of ["LICENSE", "NOTICE", "TRADEMARKS.md"])
    await writeFile(join(packageRoot, name), "fixture notice");
  const manifest = {
    name: "code60",
    version: "0.5.0",
    private: true,
    type: "module",
    engines: { node: ">=24.22.0 <25" },
    bin: { code60: "bin/code60.mjs" },
  };
  const platforms = {
    "darwin-arm64": descriptor("darwin", "arm64"),
    "linux-x64": descriptor("linux", "x64"),
  };
  const metadata = {
    name: "code60",
    version: "0.5.0",
    dist: { tarball: `${registry}/-/code60-0.5.0.tgz`, integrity: "" },
  };
  const calls: string[] = [];
  let bytes: Buffer = Buffer.alloc(0);
  async function pack() {
    await writeFile(join(packageRoot, "package.json"), JSON.stringify(manifest));
    await writeFile(join(packageRoot, "platforms.json"), JSON.stringify(platforms));
    const archive = join(parent, "bootstrap.tgz");
    await rm(archive, { force: true });
    await writeArchive(source, archive);
    bytes = await readFile(archive);
    metadata.dist.integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  }
  await pack();
  const transport = (url: string) => {
    calls.push(url);
    return Readable.from([url.endsWith("/latest") ? Buffer.from(JSON.stringify(metadata)) : bytes]);
  };
  return {
    parent,
    packageRoot,
    source,
    manifest,
    platforms,
    metadata,
    calls,
    transport,
    pack,
    executed,
    bytes: () => bytes,
  };
}

it.each([
  ["0.5.0", "0.4.1", true],
  ["0.5.0", "0.5.0", false],
  ["0.5.0", "0.5.1", false],
  ["0.5.0", "0.5.0-rc.1", true],
  ["1.0.0", "0.99.99", true],
  ["0.5.0", "1.0.0-rc.1", false],
  ["0.10.0", "0.9.9", true],
  ["0.5.10", "0.5.9", true],
] as const)(
  "compares stable %s against %s without downgrading",
  (candidate, installed, expected) => {
    expect(newerStableRelease(candidate, installed)).toBe(expected);
  },
);
it.each(["01.0.0", "0.1", "latest", "0.5.0-rc.1", "0.5.0+build", "9007199254740992.0.0"])(
  "rejects ambiguous/non-stable candidate %s",
  (version) => {
    expect(() => newerStableRelease(version, "0.4.1")).toThrow();
  },
);
it.each([
  "01.0.0",
  "0.1.0-",
  "0.1.0-rc..1",
  "0.1.0-01",
  "0.1.0-rc/1",
  "9007199254740992.0.0",
  "x".repeat(129),
])("rejects invalid installed version %s", (version) => {
  expect(() => newerStableRelease("1.0.0", version)).toThrow();
});

it("verifies npm SHA-512 and both embedded descriptors without executing bootstrap code", async () => {
  const f = await fixture();
  const foreign = join(f.parent, ".code60-update-bootstrap-foreign");
  await mkdir(foreign);
  await writeFile(join(foreign, "keep"), "other run");
  const result = await readStableBootstrap({ parent: f.parent, transport: f.transport });
  expect(result).toEqual({
    version: "0.5.0",
    integrity: f.metadata.dist.integrity,
    sha256: createHash("sha256").update(f.bytes()).digest("hex"),
    descriptor: f.platforms[`${process.platform}-${process.arch}` as keyof typeof f.platforms],
  });
  expect(f.calls).toEqual([`${registry}/latest`, `${registry}/-/code60-0.5.0.tgz`]);
  expect(await readdir(f.parent)).toEqual(
    expect.arrayContaining(["source", "bootstrap.tgz", ".code60-update-bootstrap-foreign"]),
  );
  expect(
    (await readdir(f.parent)).filter((name) => name.startsWith(".code60-update-bootstrap-")).length,
  ).toBe(1);
  await expect(readFile(f.executed)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(foreign, "keep"), "utf8")).toBe("other run");
});

it.each([
  "name",
  "prerelease",
  "unsafe-version",
  "registry",
  "sha1",
  "bad-integrity",
  "noncanonical-integrity",
])("rejects unsafe npm metadata (%s) before requesting a tarball", async (mode) => {
  const f = await fixture();
  if (mode === "name") f.metadata.name = "another-package";
  if (mode === "prerelease") f.metadata.version = "0.5.0-rc.1";
  if (mode === "unsafe-version") f.metadata.version = "../0.5.0";
  if (mode === "registry") f.metadata.dist.tarball = "https://example.com/bootstrap.tgz";
  if (mode === "sha1") f.metadata.dist.integrity = "sha1-abc";
  if (mode === "bad-integrity") f.metadata.dist.integrity = "sha512-not-base64";
  if (mode === "noncanonical-integrity") f.metadata.dist.integrity = `sha512-${"A".repeat(85)}B==`;
  await expect(readStableBootstrap({ parent: f.parent, transport: f.transport })).rejects.toThrow();
  expect(f.calls).toEqual([`${registry}/latest`]);
});

it.each(["hash", "metadata-limit", "archive-limit", "corrupt"])(
  "bounds/rejects registry download %s",
  async (mode) => {
    const f = await fixture();
    const corrupt = Buffer.from("not a gzip archive");
    if (mode === "corrupt")
      f.metadata.dist.integrity = `sha512-${createHash("sha512").update(corrupt).digest("base64")}`;
    const transport = (url: string) => {
      if (mode === "metadata-limit") return Readable.from([Buffer.alloc(256 * 1024 + 1)]);
      if (url.endsWith("/latest")) return f.transport(url);
      if (mode === "archive-limit") return Readable.from([Buffer.alloc(1024 ** 2)]);
      return Readable.from([corrupt]);
    };
    await expect(readStableBootstrap({ parent: f.parent, transport })).rejects.toThrow();
    expect(
      (await readdir(f.parent)).some((name) => name.startsWith(".code60-update-bootstrap-")),
    ).toBe(false);
  },
);

it.each([
  "script",
  "dependency",
  "optional",
  "peer",
  "bundle",
  "engines",
  "bin",
  "version",
  "name",
  "missing-notice",
  "missing-platform",
  "extra-platform",
  "swapped-platform",
  "commit",
  "dirty",
  "url",
  "unexpected-file",
  "link",
])(
  "rejects verified but unsupported bootstrap contents (%s) and removes owned staging",
  async (mode) => {
    const f = await fixture();
    const manifest = f.manifest as Record<string, unknown>;
    if (mode === "script") manifest.scripts = { postinstall: "dangerous" };
    if (mode === "dependency") manifest.dependencies = {};
    if (mode === "optional") manifest.optionalDependencies = {};
    if (mode === "peer") manifest.peerDependencies = {};
    if (mode === "bundle") manifest.bundledDependencies = [];
    if (mode === "engines") manifest.engines = { node: ">=25" };
    if (mode === "bin") manifest.bin = { code60: "different.mjs" };
    if (mode === "version") manifest.version = "0.6.0";
    if (mode === "name") manifest.name = "another-package";
    if (mode === "missing-notice") await rm(join(f.packageRoot, "NOTICE"));
    const platforms = f.platforms as Record<string, PayloadDescriptor>;
    if (mode === "missing-platform") delete platforms["linux-x64"];
    if (mode === "extra-platform") platforms.other = descriptor("linux", "x64");
    if (mode === "swapped-platform") {
      platforms["linux-x64"] = f.platforms["darwin-arm64"];
      platforms["darwin-arm64"] = descriptor("linux", "x64");
    }
    if (mode === "commit") f.platforms["linux-x64"].commit = "c".repeat(40);
    if (mode === "dirty") {
      f.platforms["linux-x64"].dirty = true;
      f.platforms["darwin-arm64"].dirty = true;
    }
    if (mode === "url") f.platforms["linux-x64"].archive.url = "https://example.com/payload";
    if (mode === "unexpected-file") await writeFile(join(f.packageRoot, "surprise"), "unexpected");
    if (mode === "link") await symlink("../NOTICE", join(f.packageRoot, "lib/descriptor.mjs"));
    await f.pack();
    await expect(
      readStableBootstrap({ parent: f.parent, transport: f.transport }),
    ).rejects.toThrow();
    expect(
      (await readdir(f.parent)).some((name) => name.startsWith(".code60-update-bootstrap-")),
    ).toBe(false);
    await expect(readFile(f.executed)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it("honors cancellation and download deadline, never acquiring outside a safe private parent", async () => {
  const f = await fixture();
  await expect(
    readStableBootstrap({ parent: f.parent, transport: f.transport, signal: AbortSignal.abort() }),
  ).rejects.toThrow();
  expect(f.calls).toEqual([]);
  const transport = () => new Readable({ read() {} });
  await expect(readStableBootstrap({ parent: f.parent, transport, timeout: 5 })).rejects.toThrow();
  const link = join(f.parent, "unsafe");
  await symlink(f.parent, link);
  await expect(readStableBootstrap({ parent: link, transport: f.transport })).rejects.toThrow(
    "Unsafe",
  );
  await expect(readStableBootstrap({ parent: "relative", transport: f.transport })).rejects.toThrow(
    "absolute",
  );
});

it("reports cleanup failure even after successful verification and preserves the uncertain tree", async () => {
  const f = await fixture();
  await expect(
    readStableBootstrap({
      parent: f.parent,
      transport: f.transport,
      remove: async () => {
        throw Error("injected removal failure");
      },
    }),
  ).rejects.toThrow("cleanup failed");
  expect(
    (await readdir(f.parent)).filter((name) => name.startsWith(".code60-update-bootstrap-")).length,
  ).toBe(1);
});

it("uses a fixed public registry without credentials or redirects and diagnoses HTTP errors", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("fixture"));
  vi.stubGlobal("fetch", fetcher);
  const signal = AbortSignal.timeout(1000);
  const stream = await registryTransport(`${registry}/latest`, { signal });
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(Buffer.from(part));
  expect(Buffer.concat(parts).toString()).toBe("fixture");
  expect(fetcher).toHaveBeenCalledWith(
    `${registry}/latest`,
    expect.objectContaining({ signal, credentials: "omit", redirect: "error" }),
  );
  for (const url of [
    "http://registry.npmjs.org/code60/latest",
    `${registry}/latest?token=secret`,
    `${registry}/-/code60-0.5.0.tgz#x`,
    "https://example.com/bootstrap",
    "https://user@registry.npmjs.org/code60/latest",
  ])
    await expect(registryTransport(url, {})).rejects.toThrow("Unapproved");
  for (const status of [301, 302, 404, 500]) {
    fetcher.mockResolvedValueOnce(new Response(null, { status }));
    await expect(registryTransport(`${registry}/latest`, {})).rejects.toThrow(`HTTP ${status}`);
  }
});
