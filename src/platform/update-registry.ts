import { createHash, timingSafeEqual } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { addAbortSignal, Readable } from "node:stream";
import {
  installationDirectory,
  installationSnapshot,
  installationTreeIdentity,
  removeInstallationTree,
} from "./installation-files.js";
import type { PayloadTransport } from "./payload-acquire.mjs";
import { extractArchive } from "./payload-archive.mjs";
import { descriptorPair, type PayloadDescriptor, platform } from "./payload-descriptor.mjs";

const registry = "https://registry.npmjs.org/code60";
const bootstrapLimit = 1024 ** 2;
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function versionParts(version: string) {
  if (typeof version !== "string" || version.length > 128) throw Error("Invalid release version");
  const parts = version.split("-");
  const base = parts.shift() ?? "";
  if (!stable.test(base)) throw Error("Invalid release version");
  const numbers = base.split(".").map(Number);
  if (numbers.some((part) => !Number.isSafeInteger(part))) throw Error("Invalid release version");
  const preview = parts.join("-");
  if (
    parts.length &&
    (!preview ||
      preview.split(".").some((part) => !/^[0-9A-Za-z-]+$/.test(part) || /^0\d+$/.test(part)))
  )
    throw Error("Invalid release version");
  return { numbers, preview };
}

export function newerStableRelease(candidate: string, installed: string) {
  const next = versionParts(candidate);
  const current = versionParts(installed);
  if (!stable.test(candidate)) throw Error("Update candidate must be a stable release");
  for (let i = 0; i < 3; i++) {
    const left = next.numbers[i] ?? 0;
    const right = current.numbers[i] ?? 0;
    if (left !== right) return left > right;
  }
  return Boolean(current.preview);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid stable bootstrap metadata");
  return value as Record<string, unknown>;
}

// Public npm metadata and tarballs only. No npm configuration, credentials,
// environment URL overrides, alternate registries or redirect targets are used.
export async function registryTransport(
  url: string,
  { signal }: { signal?: AbortSignal | undefined },
) {
  if (
    url !== `${registry}/latest` &&
    !/^https:\/\/registry\.npmjs\.org\/code60\/-\/code60-\d+\.\d+\.\d+\.tgz$/.test(url)
  )
    throw Error("Unapproved bootstrap registry URL");
  const response = await fetch(url, {
    ...(signal ? { signal } : {}),
    redirect: "error",
    credentials: "omit",
    headers: { accept: "application/json" },
  });
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    throw Error(`Bootstrap registry request failed: HTTP ${response.status}`);
  }
  return Readable.from(response.body);
}

async function boundedBytes(
  transport: PayloadTransport,
  url: string,
  maximum: number,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const incoming = await transport(url, { signal });
  const stream =
    incoming instanceof Readable
      ? addAbortSignal(signal, incoming)
      : Readable.fromWeb(incoming as Parameters<typeof Readable.fromWeb>[0], { signal });
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      signal.throwIfAborted();
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > maximum) throw Error("Bootstrap registry response exceeded size limit");
      chunks.push(bytes);
    }
    signal.throwIfAborted();
    return Buffer.concat(chunks, size);
  } finally {
    stream.destroy();
  }
}

const json = (bytes: Uint8Array) =>
  object(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
const bootstrapFile = (path: string) =>
  /^package\/(?:bin\/code60\.mjs|lib\/(?:index|acquire|archive|descriptor)\.mjs|package\.json|platforms\.json|LICENSE|NOTICE|TRADEMARKS\.md)$/.test(
    path,
  ) || /^package\/lib\/runtime\/(?:management|platform)\/[a-z0-9-]+\.(?:js|mjs)$/.test(path);
const bootstrapDirectory = (path: string) =>
  /^package(?:\/bin|\/lib(?:\/runtime(?:\/(?:management|platform))?)?)?$/.test(path);

export interface StableBootstrap {
  version: string;
  integrity: string;
  sha256: string;
  descriptor: PayloadDescriptor;
}

// The package is parsed as data. Never import its adapter or run its entrypoint:
// the currently installed verifier is the authority for the candidate payload.
export async function readStableBootstrap(options: {
  parent: string;
  signal?: AbortSignal;
  transport?: PayloadTransport;
  timeout?: number;
  remove?: typeof removeInstallationTree;
}): Promise<StableBootstrap> {
  const target = platform();
  await installationDirectory(options.parent, false, true);
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(options.timeout ?? 300_000),
  ]);
  const transport = options.transport ?? registryTransport;
  const metadata = json(await boundedBytes(transport, `${registry}/latest`, 256 * 1024, signal));
  if (metadata.name !== "code60" || typeof metadata.version !== "string")
    throw Error("Stable bootstrap package identity mismatch");
  versionParts(metadata.version);
  if (!stable.test(metadata.version)) throw Error("The npm latest bootstrap must be stable");
  const dist = object(metadata.dist);
  if (
    dist.tarball !== `${registry}/-/code60-${metadata.version}.tgz` ||
    typeof dist.integrity !== "string" ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/.test(dist.integrity)
  )
    throw Error("Stable bootstrap requires canonical npm tarball and SHA-512 integrity");
  const expected = Buffer.from(dist.integrity.slice(7), "base64");
  if (expected.toString("base64") !== dist.integrity.slice(7))
    throw Error("Invalid bootstrap integrity encoding");
  const bytes = await boundedBytes(transport, dist.tarball, bootstrapLimit - 1, signal);
  if (!timingSafeEqual(expected, createHash("sha512").update(bytes).digest()))
    throw Error("Stable bootstrap registry integrity mismatch");
  signal.throwIfAborted();
  const owned = await mkdtemp(join(options.parent, ".code60-update-bootstrap-"));
  const identity = await installationTreeIdentity(owned);
  let result: StableBootstrap | undefined;
  let failure: unknown;
  try {
    const archive = join(owned, "bootstrap.tgz");
    await writeFile(archive, bytes, { flag: "wx", mode: 0o600 });
    const root = join(owned, "extracted");
    const entries = await extractArchive(archive, root, join(owned, "bootstrap.tar"), {
      signal,
      bounds: { expanded: 8 * 1024 ** 2, entries: 2000 },
    });
    if (
      entries.some((entry) =>
        entry.type === "5"
          ? !bootstrapDirectory(entry.path)
          : entry.type !== "0" || !bootstrapFile(entry.path),
      )
    )
      throw Error("Unexpected stable bootstrap contents");
    for (const required of [
      "package.json",
      "platforms.json",
      "bin/code60.mjs",
      "lib/index.mjs",
      "LICENSE",
      "NOTICE",
      "TRADEMARKS.md",
    ])
      if (!entries.some((entry) => entry.path === `package/${required}` && entry.type === "0"))
        throw Error("Stable bootstrap required file missing");
    const manifestFile = await installationSnapshot(join(root, "package/package.json"), 64 * 1024);
    const platformsFile = await installationSnapshot(
      join(root, "package/platforms.json"),
      64 * 1024,
    );
    if (!manifestFile || !platformsFile) throw Error("Stable bootstrap metadata missing");
    const manifest = object(JSON.parse(manifestFile.text));
    if (
      manifest.name !== "code60" ||
      manifest.version !== metadata.version ||
      manifest.type !== "module" ||
      object(manifest.engines).node !== ">=24.22.0 <25" ||
      object(manifest.bin).code60 !== "bin/code60.mjs" ||
      [
        "scripts",
        "dependencies",
        "optionalDependencies",
        "peerDependencies",
        "bundledDependencies",
        "bundleDependencies",
      ].some((key) => Object.hasOwn(manifest, key))
    )
      throw Error("Stable bootstrap manifest is not dependency-free or has a conflicting identity");
    const embedded = object(JSON.parse(platformsFile.text));
    if (Object.keys(embedded).sort().join(",") !== "darwin-arm64,linux-x64")
      throw Error("Stable bootstrap must embed exactly both platform descriptors");
    const descriptors = descriptorPair(Object.values(embedded), metadata.version);
    if (
      Object.entries(embedded).some(([key, value]) => descriptors[key] !== value) ||
      Object.values(descriptors).some((value) => value.dirty)
    )
      throw Error("Stable bootstrap descriptor identity/provenance mismatch");
    const descriptor = descriptors[target];
    if (!descriptor) throw Error("Stable bootstrap target missing");
    signal.throwIfAborted();
    result = {
      version: metadata.version,
      integrity: dist.integrity,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      descriptor,
    };
  } catch (error) {
    failure = error;
  }
  try {
    await (options.remove ?? removeInstallationTree)(owned, identity);
  } catch (cleanup) {
    failure = new AggregateError(
      [...(failure ? [failure] : []), cleanup],
      `Stable bootstrap staging cleanup failed: ${owned}`,
    );
  }
  if (failure) throw failure;
  return result as StableBootstrap;
}
