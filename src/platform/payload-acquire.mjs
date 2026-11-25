import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdtemp, readFile, realpath, rm, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extractArchive } from "./payload-archive.mjs";
import { descriptor, platform } from "./payload-descriptor.mjs";

export async function sha256(path, signal) {
  const hash = createHash("sha256");
  for await (const data of createReadStream(path)) {
    signal?.throwIfAborted();
    hash.update(data);
  }
  return hash.digest("hex");
}

const VERIFY_SMALL_BYTES = 256 * 1024;
const VERIFY_CONCURRENCY = 16;

async function fileSha256(path, size, signal) {
  if (size <= VERIFY_SMALL_BYTES) {
    const bytes = await readFile(path, { signal });
    return createHash("sha256").update(bytes).digest("hex");
  }
  return sha256(path, signal);
}

async function verifyEntries(root, actual, inventory, signal) {
  let index = 0;
  let failed;
  const worker = async () => {
    while (!failed) {
      signal?.throwIfAborted();
      const current = index++;
      if (current >= actual.length) return;
      const entry = actual[current];
      const item = inventory.get(entry.path);
      try {
        if (
          !item ||
          item.type !== entry.type ||
          (entry.type === "2"
            ? item.link !== entry.link
            : item.size !== entry.size ||
              item.sha256 !== (await fileSha256(join(root, entry.path), entry.size, signal)))
        ) {
          failed ??= new Error("Payload file integrity mismatch");
          return;
        }
      } catch (error) {
        failed ??= error;
        return;
      }
    }
  };
  await Promise.allSettled(
    Array.from({ length: Math.min(VERIFY_CONCURRENCY, actual.length) }, () => worker()),
  );
  if (failed) throw failed;
  signal?.throwIfAborted();
}
const hosts = new Set([
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
]);
export async function releaseTransport(url, { signal } = {}) {
  for (let count = 0; count <= 5; count++) {
    const location = new URL(url);
    if (
      location.protocol !== "https:" ||
      !hosts.has(location.hostname) ||
      location.username ||
      location.password ||
      location.port
    )
      throw new Error("Unapproved release download origin");
    const response = await fetch(location, { redirect: "manual", signal, credentials: "omit" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const next = response.headers.get("location");
      if (!next) throw new Error("Release redirect has no location");
      url = new URL(next, location).href;
      continue;
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new Error(`Release download failed: HTTP ${response.status}`);
    }
    return response.body;
  }
  throw new Error("Too many release redirects");
}

async function verifyPayload(root, expected, entries, signal) {
  if ((entries.find((entry) => entry.path === "payload.json")?.size ?? Infinity) > 64 * 1024 ** 2)
    throw new Error("Payload metadata is missing or oversized");
  const metadata = JSON.parse(await readFile(join(root, "payload.json"), "utf8"));
  if (
    metadata.schemaVersion !== 1 ||
    metadata.version !== expected.version ||
    metadata.commit !== expected.commit ||
    metadata.dirty !== expected.dirty ||
    metadata.os !== expected.os ||
    metadata.arch !== expected.arch ||
    metadata.runtime?.node !== expected.runtime.node ||
    metadata.runtime?.libc !== expected.runtime.libc ||
    !/^[a-f0-9]{64}$/.test(metadata.lockfileSha256) ||
    !Array.isArray(metadata.files)
  )
    throw new Error("Extracted payload identity mismatch");
  const allowed = new Set([
    "dist",
    "models",
    "node_modules",
    "package.json",
    "package-lock.json",
    "mcp.default.json",
    "LICENSE",
    "NOTICE",
    "TRADEMARKS.md",
    "payload.json",
    "production-dependencies.json",
  ]);
  if (entries.some((entry) => !allowed.has(entry.path.split("/")[0])))
    throw new Error("Unexpected payload content");
  const inventory = new Map(metadata.files.map((entry) => [entry.path, entry]));
  const engineFiles = metadata.files.filter((entry) => entry.path.startsWith("dist/engines/"));
  if (expected.os === "linux" && metadata.transmissionBundle === undefined) {
    if (engineFiles.length) throw Error("Linux payload contains an undeclared Transmission bundle");
  } else if (
    !/^[a-f0-9]{64}$/.test(metadata.transmissionBundle) ||
    !inventory.has(`dist/engines/${metadata.transmissionBundle}/bundle.json`) ||
    engineFiles.some(
      (entry) => !entry.path.startsWith(`dist/engines/${metadata.transmissionBundle}/`),
    )
  )
    throw Error(
      `${expected.os === "darwin" ? "macOS" : "Linux"} payload requires its pinned Transmission bundle`,
    );
  const actual = entries.filter((entry) => entry.type !== "5" && entry.path !== "payload.json");
  if (inventory.size !== metadata.files.length || inventory.size !== actual.length)
    throw new Error("Payload inventory mismatch");
  // Older private payloads did not describe empty directories. New payloads
  // pin every directory so later removal need not claim an unrecorded object.
  if (metadata.directories !== undefined) {
    const directories = new Set(
      entries.filter((entry) => entry.type === "5").map((entry) => entry.path),
    );
    if (
      !Array.isArray(metadata.directories) ||
      metadata.directories.length !== directories.size ||
      new Set(metadata.directories).size !== directories.size ||
      metadata.directories.some((path) => typeof path !== "string" || !directories.has(path))
    )
      throw Error("Payload directory inventory mismatch");
  }
  await verifyEntries(root, actual, inventory, signal);
  for (const path of [
    "package.json",
    "dist/management/main.js",
    "dist/gateway/main.js",
    "dist/renderer/index.html",
    "dist/licenses/models/provenance.json",
    "models/provenance.json",
    ...[
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
      "README.md",
    ].map((name) => `models/jinaai/jina-embeddings-v2-base-code/${name}`),
    "models/jinaai/jina-embeddings-v2-base-code/onnx/model_quantized.onnx",
    "node_modules/onnxruntime-node/package.json",
    "node_modules/@agentclientprotocol/sdk/package.json",
  ])
    if (!(await lstat(join(root, path)).catch(() => null))?.isFile())
      throw new Error(`Required payload asset missing: ${path}`);
  const html = await readFile(join(root, "dist/renderer/index.html"), "utf8");
  const assets = [...html.matchAll(/(?:src|href)="\.\/(assets\/[^"?]+\.(?:js|css))"/g)].map(
    (match) => match[1],
  );
  if (!assets.some((path) => path.endsWith(".js")) || !assets.some((path) => path.endsWith(".css")))
    throw new Error("Required renderer entry assets missing");
  for (const path of assets) {
    if (
      path.split("/").some((part) => part === ".." || part === ".") ||
      !inventory.has(`dist/renderer/${path}`) ||
      !(await lstat(join(root, "dist/renderer", path))).isFile()
    )
      throw new Error("Required renderer entry asset missing");
  }
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (manifest.name !== "code60" || manifest.version !== expected.version)
    throw new Error("Payload package identity mismatch");
  if ((await sha256(join(root, "package-lock.json"))) !== metadata.lockfileSha256)
    throw new Error("Payload lockfile mismatch");
  return metadata;
}

// Internal port injection only: no public CLI/environment download overrides.
export async function acquirePayload(
  value,
  {
    parent,
    signal,
    transport = releaseTransport,
    host = process,
    remove = rm,
    timeout = 300_000,
  } = {},
) {
  const expected = descriptor(value);
  if (platform(host) !== `${expected.os}-${expected.arch}`)
    throw new Error("Payload platform mismatch");
  if (
    !parent ||
    (await realpath(parent)) !== resolve(parent) ||
    !(await lstat(parent)).isDirectory()
  )
    throw new Error("Unsafe payload staging parent");
  const cancellation = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
    : AbortSignal.timeout(timeout);
  cancellation.throwIfAborted();
  const owned = await mkdtemp(join(parent, ".code60-payload-"));
  const archive = join(owned, "archive.tar.gz");
  const unpacked = join(owned, "archive.tar");
  const root = join(owned, "application");
  try {
    const hash = createHash("sha256");
    let size = 0;
    const bytes = await transport(expected.archive.url, { signal: cancellation });
    await pipeline(
      bytes,
      new Transform({
        transform(chunk, _encoding, next) {
          size += chunk.length;
          if (size > expected.archive.size)
            return next(new Error("Payload download exceeded pinned size"));
          hash.update(chunk);
          next(null, chunk);
        },
      }),
      createWriteStream(archive, { flags: "wx", mode: 0o600 }),
      { signal: cancellation },
    );
    if (size !== expected.archive.size || hash.digest("hex") !== expected.archive.sha256)
      throw new Error("Payload download size/checksum mismatch");
    const entries = await extractArchive(archive, root, unpacked, { signal: cancellation });
    await verifyPayload(root, expected, entries, cancellation);
    await unlink(archive);
    await unlink(unpacked);
    return { root, owned, descriptor: expected };
  } catch (error) {
    try {
      await remove(owned, { recursive: true, force: true });
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        `Payload failure and owned staging cleanup failed: ${owned}`,
      );
    }
    throw error;
  }
}
