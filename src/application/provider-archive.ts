import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, symlink } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { createGunzip } from "node:zlib";
import { ProviderSetupError } from "./provider-setup-policy.js";

export interface ProviderArtifact {
  url: string;
  integrity: string;
}
/** Exact descriptors only; redirects never expand the allowed download origin. */
export async function downloadProviderArtifact(
  artifact: ProviderArtifact,
  file: string,
  signal: AbortSignal,
  fetcher = fetch,
): Promise<void> {
  const url = new URL(artifact.url);
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new ProviderSetupError("install");
  const response = await fetcher(url, { signal, redirect: "error" });
  if (!response.ok || !response.body) throw new ProviderSetupError("install");
  const [algorithm, expected] = artifact.integrity.split("-");
  if (!expected || !["sha256", "sha512"].includes(algorithm ?? ""))
    throw new ProviderSetupError("install");
  const hash = createHash(algorithm as string);
  const output = await open(file, "wx", 0o600);
  let size = 0;
  try {
    for await (const bytes of response.body) {
      signal.throwIfAborted();
      size += bytes.length;
      if (size > 350 * 1024 * 1024) throw new ProviderSetupError("install");
      hash.update(bytes);
      await output.writeFile(bytes);
    }
    if (hash.digest("base64") !== expected) throw new ProviderSetupError("install");
  } finally {
    await output.close();
  }
}
const invalidCharacters = (value: string) =>
  [...value].some(
    (character) =>
      character.charCodeAt(0) < 32 ||
      character.charCodeAt(0) === 127 ||
      character === "\\" ||
      character === ":",
  );
const pathName = (value: string) => {
  const path = value.replace(/^\.\//, "").replace(/\/$/, "");
  if (
    !path ||
    path.length > 4096 ||
    path.startsWith("/") ||
    invalidCharacters(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new ProviderSetupError("install");
  return path;
};
const textField = (header: Buffer, start: number, length: number) =>
  header
    .subarray(start, start + length)
    .toString("utf8")
    .split("\0")[0] ?? "";
const octal = (value: string) => {
  if (!/^[0-7]+$/.test(value.trim())) throw new ProviderSetupError("install");
  return Number.parseInt(value.trim(), 8);
};
/** Bounded USTAR/PAX extraction. Links are created last; files never traverse archive links. */
export async function extractProviderArchive(
  file: string,
  destination: string,
  signal: AbortSignal,
): Promise<void> {
  // Complete asynchronous preparation before starting a stream whose errors
  // are consumed by the iterator below. A failed mkdir must open no input.
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const source = createReadStream(file);
  const gzip = source.pipe(createGunzip());
  source.on("error", (error) => gzip.destroy(error));
  const iterator = gzip[Symbol.asyncIterator]();
  let pending = Buffer.alloc(0);
  let expanded = 0;
  const read = async (size: number): Promise<Buffer> => {
    const parts: Buffer[] = [];
    let remaining = size;
    while (remaining) {
      signal.throwIfAborted();
      if (!pending.length) {
        const next = await iterator.next();
        if (next.done) throw new ProviderSetupError("install");
        pending = Buffer.from(next.value);
        expanded += pending.length;
        if (expanded > 1024 * 1024 * 1024) throw new ProviderSetupError("install");
      }
      const length = Math.min(remaining, pending.length);
      parts.push(pending.subarray(0, length));
      pending = pending.subarray(length);
      remaining -= length;
    }
    return parts.length === 1 ? (parts[0] as Buffer) : Buffer.concat(parts);
  };
  const links: { path: string; target: string }[] = [];
  let overrides: Record<string, string> = {};
  let entries = 0;
  try {
    for (;;) {
      const header = await read(512);
      if (header.every((byte) => byte === 0)) break;
      if (++entries > 10_000) throw new ProviderSetupError("install");
      const checksum = octal(textField(header, 148, 8));
      if (
        header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0) !==
        checksum
      )
        throw new ProviderSetupError("install");
      const size = octal(textField(header, 124, 12));
      if (size > 512 * 1024 * 1024) throw new ProviderSetupError("install");
      const type = textField(header, 156, 1) || "0";
      if (["x", "g", "L", "K"].includes(type)) {
        if (size > 64 * 1024 || type === "g") throw new ProviderSetupError("install");
        const extended = (await read(size)).toString("utf8");
        if (type === "L" || type === "K")
          overrides[type === "L" ? "path" : "linkpath"] = extended
            .replace(/\0.*$/s, "")
            .replace(/\n$/, "");
        else {
          let offset = 0;
          while (offset < Buffer.byteLength(extended)) {
            const bytes = Buffer.from(extended);
            const end = bytes.indexOf(32, offset);
            const length = Number(bytes.subarray(offset, end).toString());
            if (
              end < 0 ||
              !Number.isSafeInteger(length) ||
              length <= end - offset + 1 ||
              offset + length > bytes.length
            )
              throw new ProviderSetupError("install");
            const record = bytes.subarray(end + 1, offset + length - 1).toString();
            const separator = record.indexOf("=");
            if (separator > 0) overrides[record.slice(0, separator)] = record.slice(separator + 1);
            offset += length;
          }
        }
      } else {
        const prefix = textField(header, 345, 155);
        const name = overrides.path ?? `${prefix ? `${prefix}/` : ""}${textField(header, 0, 100)}`;
        // A root directory marker is harmless; no other empty/dot path is allowed.
        if ((name === "./" || name === ".") && type === "5" && size === 0) {
          overrides = {};
          continue;
        }
        const path = pathName(name);
        const target = join(destination, path);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        if (type === "5" && size === 0) await mkdir(target, { recursive: true, mode: 0o700 });
        else if (type === "2" && size === 0) {
          const link = overrides.linkpath ?? textField(header, 157, 100);
          if (!link || link.startsWith("/") || invalidCharacters(link))
            throw new ProviderSetupError("install");
          pathName(posix.normalize(posix.join(posix.dirname(path), link)));
          links.push({ path: target, target: link });
        } else if (type === "0") {
          const output = await open(
            target,
            "wx",
            octal(textField(header, 100, 8)) & 0o111 ? 0o700 : 0o600,
          );
          try {
            for (let left = size; left > 0; ) {
              const bytes = await read(Math.min(left, 64 * 1024));
              await output.writeFile(bytes);
              left -= bytes.length;
            }
          } finally {
            await output.close();
          }
        } else throw new ProviderSetupError("install");
        overrides = {};
      }
      if (size % 512) await read(512 - (size % 512));
    }
    for (const link of links) {
      signal.throwIfAborted();
      await symlink(link.target, link.path);
    }
  } finally {
    source.destroy();
    gzip.destroy();
  }
}
