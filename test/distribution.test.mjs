import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquirePayload, releaseTransport, sha256 } from "../scripts/distribution/acquire.mjs";
import { extractArchive, writeArchive } from "../scripts/distribution/archive.mjs";
import {
  descriptor,
  descriptorPair,
  limits,
  nodeRange,
  platform,
} from "../scripts/distribution/descriptor.mjs";
import {
  inventory,
  inventoryDirectories,
  nativeAllowed,
  pruneNative,
} from "../scripts/distribution/policy.mjs";
import { updateFixture } from "../scripts/distribution/update-fixture.mjs";
import { packageBootstrap } from "../scripts/package-bootstrap.mjs";
import { readStableBootstrap } from "../src/platform/index.js";

const execute = promisify(execFile);
const directories = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const root of directories.splice(0)) await rm(root, { recursive: true, force: true });
});
async function temp() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "code60 distribution spaces ")));
  directories.push(root);
  return root;
}
const host = {
  platform: "linux",
  arch: "x64",
  versions: { node: "24.22.0" },
  report: { getReport: () => ({ header: { glibcVersionRuntime: "2.36" } }) },
};
function value(os = "linux", arch = "x64") {
  const name = `code60-0.4.1-${os}-${arch}.tar.gz`;
  return {
    schemaVersion: 1,
    version: "0.4.1",
    commit: "a".repeat(40),
    dirty: false,
    os,
    arch,
    runtime: { node: nodeRange, libc: os === "linux" ? "glibc" : null },
    archive: {
      name,
      size: 100,
      sha256: "1".repeat(64),
      url: `https://github.com/CodeManufactoryLLC/Code60/releases/download/v0.4.1/${name}`,
    },
  };
}
async function fixture(os = "linux", arch = "x64") {
  const parent = await temp();
  const root = join(parent, "source");
  await mkdir(root);
  for (const path of [
    "dist/management/main.js",
    "dist/gateway/main.js",
    "dist/renderer/index.html",
    "dist/renderer/assets/index.js",
    "dist/renderer/assets/index.css",
    ...[
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
      "README.md",
    ].map((name) => `models/jinaai/jina-embeddings-v2-base-code/${name}`),
    "dist/licenses/models/provenance.json",
    "models/provenance.json",
    "models/jinaai/jina-embeddings-v2-base-code/onnx/model_quantized.onnx",
    "node_modules/onnxruntime-node/package.json",
    "node_modules/@agentclientprotocol/sdk/package.json",
    "package-lock.json",
    "LICENSE",
  ]) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), "synthetic fixture");
  }
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "code60", version: "0.4.1" }));
  await writeFile(
    join(root, "dist/renderer/index.html"),
    '<script src="./assets/index.js"></script><link href="./assets/index.css">',
  );
  const expected = value(os, arch);
  const pack = async (includeDirectories = false) => {
    await rm(join(root, "payload.json"), { force: true });
    await writeFile(
      join(root, "payload.json"),
      JSON.stringify({
        ...expected,
        lockfileSha256: await sha256(join(root, "package-lock.json")),
        files: await inventory(root),
        ...(includeDirectories ? { directories: await inventoryDirectories(root) } : {}),
      }),
    );
    const archive = join(parent, expected.archive.name);
    await rm(archive, { force: true });
    await writeArchive(root, archive);
    expected.archive.size = (await stat(archive)).size;
    expected.archive.sha256 = await sha256(archive);
    return archive;
  };
  const archive = await pack();
  return { parent, root, expected, archive, pack, transport: () => createReadStream(archive) };
}
function rawEntry(path, { type = "0", link = "", mode = 0o644, content = "" } = {}) {
  const h = Buffer.alloc(512);
  h.write(path, 0, 100);
  h.write(`${mode.toString(8).padStart(7, "0")}\0`, 100, 8);
  h.write("0000000\0", 108, 8);
  h.write("0000000\0", 116, 8);
  h.write(`${Buffer.byteLength(content).toString(8).padStart(11, "0")}\0`, 124, 12);
  h.fill(32, 148, 156);
  h.write(type, 156, 1);
  h.write(link, 157, 100);
  h.write("ustar\0", 257, 6);
  h.write("00", 263, 2);
  h.write(
    `${h
      .reduce((a, b) => a + b, 0)
      .toString(8)
      .padStart(6, "0")}\0 `,
    148,
    8,
  );
  return Buffer.concat([
    h,
    Buffer.from(content),
    Buffer.alloc((512 - (Buffer.byteLength(content) % 512)) % 512),
  ]);
}
async function extractRaw(parts, options) {
  const root = await temp();
  const archive = join(root, "test.gz");
  await writeFile(archive, gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)])));
  return extractArchive(archive, join(root, "out"), join(root, "tar"), options);
}

it("records and verifies empty directory ownership without following symbolic directory links", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "node_modules/native/empty platform"), { recursive: true });
  await symlink("native", join(f.root, "node_modules/link"));
  const directories = await inventoryDirectories(f.root);
  expect(directories).toContain("node_modules/native/empty platform");
  expect(directories.some((path) => path.startsWith("node_modules/link"))).toBe(false);
  await f.pack(true);
  const result = await acquirePayload(f.expected, {
    parent: f.parent,
    host,
    transport: f.transport,
  });
  expect((await stat(join(result.root, "node_modules/native/empty platform"))).isDirectory()).toBe(
    true,
  );
});

it.each(["missing", "extra", "duplicate", "unsafe", "wrong-type"])(
  "rejects %s directory metadata before accepting a payload",
  async (fault) => {
    const f = await fixture();
    await mkdir(join(f.root, "node_modules/native-empty"), { recursive: true });
    await f.pack(true);
    const path = join(f.root, "payload.json"),
      data = JSON.parse(await readFile(path, "utf8"));
    if (fault === "missing") data.directories.pop();
    if (fault === "extra") data.directories.push("unrecorded-empty");
    if (fault === "duplicate") data.directories[1] = data.directories[0];
    if (fault === "unsafe") data.directories[0] = "../../outside";
    if (fault === "wrong-type") data.directories = {};
    await writeFile(path, JSON.stringify(data));
    await rm(f.archive);
    await writeArchive(f.root, f.archive);
    f.expected.archive.size = (await stat(f.archive)).size;
    f.expected.archive.sha256 = await sha256(f.archive);
    await expect(
      acquirePayload(f.expected, { parent: f.parent, host, transport: f.transport }),
    ).rejects.toThrow("directory inventory mismatch");
    expect((await readdir(f.parent)).filter((name) => name.startsWith(".code60-payload-"))).toEqual(
      [],
    );
  },
);
describe("distribution identities", () => {
  it("requires matching exact platform descriptors and canonical fixed release URLs", () => {
    const linux = value();
    const mac = value("darwin", "arm64");
    expect(descriptorPair([linux, mac], "0.4.1")).toHaveProperty("linux-x64");
    for (const bad of [
      undefined,
      { ...linux, schemaVersion: 2 },
      { ...linux, version: "../1" },
      { ...linux, commit: "bad" },
      { ...linux, dirty: null },
      { ...linux, arch: "arm64" },
      { ...linux, runtime: { node: ">=24" } },
      { ...linux, archive: { ...linux.archive, size: limits.download + 1 } },
      { ...linux, archive: { ...linux.archive, url: "https://example.com/payload" } },
    ])
      expect(() => descriptor(bad)).toThrow();
    expect(() => descriptorPair([linux], "0.4.1")).toThrow();
    expect(() => descriptorPair([linux, linux], "0.4.1")).toThrow();
    expect(() => descriptorPair([linux, { ...mac, commit: "b".repeat(40) }], "0.4.1")).toThrow();
    expect(() => descriptorPair([linux, { ...mac, dirty: true }], "0.4.1")).toThrow();
  });
  it("rejects unsupported architectures, Node versions and musl", () => {
    expect(platform(host)).toBe("linux-x64");
    for (const patch of [
      { arch: "arm64" },
      { platform: "win32" },
      { versions: { node: "24.21.0" } },
      { versions: { node: "25.0.0" } },
      { report: { getReport: () => ({ header: {} }) } },
    ])
      expect(() => platform({ ...host, ...patch })).toThrow();
  });
  it("prunes only audited foreign native/cache paths", async () => {
    const root = await temp();
    for (const path of [
      "onnxruntime-node/bin/napi-v6/linux/x64/cpu.node",
      "onnxruntime-node/bin/napi-v6/darwin/arm64/cpu.node",
      ".cache/file",
    ]) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), "fixture");
    }
    await pruneNative(root, "linux", "x64");
    expect(
      await readFile(join(root, "onnxruntime-node/bin/napi-v6/linux/x64/cpu.node"), "utf8"),
    ).toBe("fixture");
    await expect(
      stat(join(root, "onnxruntime-node/bin/napi-v6/darwin/arm64/cpu.node")),
    ).rejects.toThrow();
    expect(nativeAllowed("sharp/lib/index.js", "linux", "x64")).toBe(true);
  });
});
it("verifies and extracts a self-contained payload into owned staging in a path with spaces", async () => {
  const f = await fixture();
  const result = await acquirePayload(f.expected, {
    parent: f.parent,
    host,
    transport: f.transport,
  });
  expect(await readFile(join(result.root, "package.json"), "utf8")).toContain("code60");
  expect(await readdir(result.owned)).toEqual(["application"]);
});

it("rejects unexpected engine bundle assets in a payload", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "dist/engines/unsupported"), { recursive: true });
  await writeFile(join(f.root, "dist/engines/unsupported/engine.js"), "unsupported engine");
  await f.pack();
  await expect(
    acquirePayload(f.expected, { parent: f.parent, host, transport: f.transport }),
  ).rejects.toThrow("legacy external engine bundles");
});
it.each(["hash", "size", "missing asset", "inventory", "identity", "extra file"])(
  "rejects %s without leaving owned staging",
  async (mode) => {
    const f = await fixture();
    if (mode === "hash") f.expected.archive.sha256 = "0".repeat(64);
    if (mode === "size") f.expected.archive.size--;
    if (mode === "missing asset") {
      await rm(join(f.root, "dist/renderer/index.html"));
      await f.pack();
    }
    if (mode === "extra file") {
      await writeFile(join(f.root, "unexpected"), "x");
      await f.pack();
    }
    if (mode === "inventory" || mode === "identity") {
      const m = JSON.parse(await readFile(join(f.root, "payload.json"), "utf8"));
      if (mode === "inventory") m.files = [];
      else m.commit = "b".repeat(40);
      await writeFile(join(f.root, "payload.json"), JSON.stringify(m));
      await rm(f.archive);
      await writeArchive(f.root, f.archive);
      f.expected.archive.size = (await stat(f.archive)).size;
      f.expected.archive.sha256 = await sha256(f.archive);
    }
    await expect(
      acquirePayload(f.expected, { parent: f.parent, host, transport: f.transport }),
    ).rejects.toThrow();
    expect((await readdir(f.parent)).filter((p) => p.startsWith(".code60-payload"))).toEqual([]);
  },
);
it("rejects platform/unsafe parent before transport, and reports cleanup failures", async () => {
  const f = await fixture();
  const transport = vi.fn(f.transport);
  await expect(
    acquirePayload(f.expected, {
      parent: f.parent,
      host: { ...host, platform: "darwin", arch: "arm64" },
      transport,
    }),
  ).rejects.toThrow("platform mismatch");
  await symlink(f.parent, join(f.parent, "redirect"));
  await expect(
    acquirePayload(f.expected, { parent: join(f.parent, "redirect"), host, transport }),
  ).rejects.toThrow("Unsafe");
  expect(transport).not.toHaveBeenCalled();
  await expect(
    acquirePayload(f.expected, {
      parent: f.parent,
      host,
      transport: () => {
        throw new Error("offline");
      },
      remove: () => {
        throw new Error("busy");
      },
    }),
  ).rejects.toThrow("cleanup failed");
});
it("honors cancellation and bounded stalled downloads", async () => {
  const f = await fixture();
  const abort = new AbortController();
  abort.abort();
  await expect(
    acquirePayload(f.expected, {
      parent: f.parent,
      host,
      signal: abort.signal,
      transport: f.transport,
    }),
  ).rejects.toThrow();
  await expect(
    acquirePayload(f.expected, {
      parent: f.parent,
      host,
      timeout: 10,
      transport: () => new Readable({ read() {} }),
    }),
  ).rejects.toThrow();
  expect((await readdir(f.parent)).filter((p) => p.startsWith(".code60-payload"))).toEqual([]);
});
it("bounds release redirects, rejects external origins and HTTP errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://release-assets.githubusercontent.com/file" },
        }),
      )
      .mockResolvedValueOnce(new Response("fixture")),
  );
  expect(await new Response(await releaseTransport(value().archive.url)).text()).toBe("fixture");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "https://attacker.example/file" } }),
      ),
  );
  await expect(releaseTransport(value().archive.url)).rejects.toThrow("Unapproved");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: value().archive.url } }),
      ),
  );
  await expect(releaseTransport(value().archive.url)).rejects.toThrow("Too many");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
  await expect(releaseTransport(value().archive.url)).rejects.toThrow("404");
});
it.each([
  ["traversal", [rawEntry("../escape")]],
  ["absolute", [rawEntry("/escape")]],
  ["duplicate", [rawEntry("file"), rawEntry("file")]],
  ["special", [rawEntry("device", { type: "3" })]],
  ["hard link", [rawEntry("link", { type: "1", link: "file" })]],
  ["escaping link", [rawEntry("link", { type: "2", link: "../outside" })]],
  [
    "link parent",
    [
      rawEntry("target", { type: "5" }),
      rawEntry("link", { type: "2", link: "target" }),
      rawEntry("link/file"),
    ],
  ],
  ["privileged mode", [rawEntry("file", { mode: 0o4755 })]],
  ["cycle", [rawEntry("a", { type: "2", link: "b" }), rawEntry("b", { type: "2", link: "a" })]],
  [
    "PAX traversal",
    [rawEntry("PaxHeader", { type: "x", content: "16 path=../evil\n" }), rawEntry("file")],
  ],
  ["bad PAX", [rawEntry("PaxHeader", { type: "x", content: "13 path=../x\n" }), rawEntry("file")]],
])("rejects unsafe tar %s before materializing entries", async (_name, parts) => {
  await expect(extractRaw(parts)).rejects.toThrow();
});
it("rejects truncated/corrupt and excessive archives", async () => {
  const root = await temp();
  await writeFile(join(root, "bad"), "corrupt");
  await expect(
    extractArchive(join(root, "bad"), join(root, "out"), join(root, "tar")),
  ).rejects.toThrow();
  await writeFile(join(root, "unfinished"), gzipSync(rawEntry("file")));
  await expect(
    extractArchive(
      join(root, "unfinished"),
      join(root, "unfinished-out"),
      join(root, "unfinished-tar"),
    ),
  ).rejects.toThrow("Incomplete");
  await expect(
    extractRaw([rawEntry("a"), rawEntry("b")], { bounds: { ...limits, entries: 1 } }),
  ).rejects.toThrow("excessive");
  await expect(
    extractRaw([rawEntry("a", { content: "x".repeat(1000) })], {
      bounds: { ...limits, expanded: 100 },
    }),
  ).rejects.toThrow("expanded");
  const h = rawEntry("a");
  h[0] = 255;
  await expect(extractRaw([h])).rejects.toThrow("checksum");
});
it("round-trips long UTF-8 paths and contained links", async () => {
  const root = await temp();
  const source = join(root, "source");
  await mkdir(source);
  const name = `${"long-path-".repeat(15)}é`;
  await writeFile(join(source, name), "content");
  await symlink(name, join(source, "link"));
  await writeArchive(source, join(root, "archive"));
  await extractArchive(join(root, "archive"), join(root, "out"), join(root, "tar"));
  expect(await readFile(join(root, "out/link"), "utf8")).toBe("content");
});
it("packs only builtins bootstrap files with both exact descriptors and strict setup CLI", async () => {
  const f = await fixture();
  const input = join(f.parent, "descriptors");
  await mkdir(input);
  const mac = value("darwin", "arm64");
  mac.archive.size = f.expected.archive.size;
  mac.archive.sha256 = f.expected.archive.sha256;
  for (const d of [f.expected, mac]) {
    await writeFile(join(input, `${d.os}-${d.arch}.json`), JSON.stringify(d));
    await cp(f.archive, join(input, d.archive.name));
  }
  const root = join(f.parent, "repository");
  await mkdir(root);
  await cp("scripts", join(root, "scripts"), { recursive: true });
  for (const name of ["LICENSE", "NOTICE", "TRADEMARKS.md"]) await cp(name, join(root, name));
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ name: "code60", version: "0.4.1", license: "Apache-2.0" }),
  );
  await cp("build/distribution", join(root, "build/distribution"), { recursive: true });
  const archive = await packageBootstrap(root, input);
  const result = await execute("tar", ["-tzf", archive]);
  expect(result.stdout).not.toMatch(/node_modules|dist\/|models\/|test\//);
  expect(result.stdout).not.toMatch(/credential|network-policy|application\/|gateway\/|renderer\//);
  expect(result.stdout).toContain("lib/runtime/platform/installation-removal.js");
  expect(result.stdout).toContain("lib/runtime/management/removal-support.js");
  const unpack = join(f.parent, "unpack");
  await mkdir(unpack);
  await execute("tar", ["-xzf", archive, "-C", unpack]);
  const manifest = JSON.parse(await readFile(join(unpack, "package/package.json"), "utf8"));
  expect(manifest.private).toBe(true);
  expect(manifest.dependencies).toBeUndefined();
  expect(manifest.scripts).toBeUndefined();
  expect(
    (
      await execute(process.execPath, [join(unpack, "package/bin/code60.mjs"), "--version"])
    ).stdout.trim(),
  ).toBe("0.4.1");
  await expect(
    execute(process.execPath, [join(unpack, "package/bin/code60.mjs"), "setup", "--unexpected"]),
  ).rejects.toMatchObject({ code: 1 });
  expect((await stat(archive)).size).toBeLessThan(1024 ** 2);
  const tarball = await readFile(archive);
  const registryResult = await readStableBootstrap({
    parent: f.parent,
    transport: (url) =>
      Readable.from([
        url.endsWith("/latest")
          ? JSON.stringify({
              name: "code60",
              version: "0.4.1",
              dist: {
                tarball: "https://registry.npmjs.org/code60/-/code60-0.4.1.tgz",
                integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
              },
            })
          : tarball,
      ]),
  });
  expect(registryResult.descriptor).toEqual(process.platform === "darwin" ? mac : f.expected);
  await writeFile(join(input, mac.archive.name), "changed");
  await expect(packageBootstrap(root, input)).rejects.toThrow("checksum");
});
it("round-trips empty, small, and large archive entries at custom compression levels and updates fixture inventory incrementally", async () => {
  const root = await temp();
  const source = join(root, "source");
  await mkdir(join(source, "nested"), { recursive: true });
  const large = Buffer.alloc(1_200_000, 0x5a);
  await writeFile(join(source, "empty.txt"), "");
  await writeFile(join(source, "nested/small.sh"), "#!/bin/sh\necho ok\n");
  await chmod(join(source, "nested/small.sh"), 0o755);
  await writeFile(join(source, "large.bin"), large);
  await symlink("nested/small.sh", join(source, "run.sh"));
  const archive = join(root, "fast.tar.gz");
  await writeArchive(source, archive, { level: 1 });
  const out = join(root, "out");
  await extractArchive(archive, out, join(root, "fast.tar"));
  expect((await stat(join(out, "empty.txt"))).size).toBe(0);
  expect((await stat(join(out, "nested/small.sh"))).mode & 0o111).toBeTruthy();
  expect(await readFile(join(out, "large.bin"))).toEqual(large);
  expect(await readFile(join(out, "run.sh"), "utf8")).toBe("#!/bin/sh\necho ok\n");

  const [hostOs, hostArch] = platform().split("-");
  const f = await fixture(hostOs, hostArch);
  const candidate = await updateFixture(f.expected, f.parent, () => createReadStream(f.archive));
  const acquired = await acquirePayload(candidate.descriptor, {
    parent: f.parent,
    transport: () => createReadStream(candidate.archive),
  });
  const metadata = JSON.parse(await readFile(join(acquired.root, "payload.json"), "utf8"));
  await rm(join(acquired.root, "payload.json"));
  expect(metadata.files).toEqual(await inventory(acquired.root));
});
