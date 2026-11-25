import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, open, readdir, readlink, symlink, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import { limits } from "./payload-descriptor.mjs";

const decoder = new TextDecoder("utf-8", { fatal: true });
const block = 512;
const SMALL_EXTRACT_BYTES = 1024 * 1024;
const EXTRACT_CONCURRENCY = 16;

async function runBounded(items, concurrency, task, signal) {
  let index = 0;
  let failed;
  const worker = async () => {
    while (!failed) {
      signal?.throwIfAborted();
      const current = index++;
      if (current >= items.length) return;
      try {
        await task(items[current]);
      } catch (error) {
        failed ??= error;
        return;
      }
    }
  };
  await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  if (failed) throw failed;
  signal?.throwIfAborted();
}
const invalidCharacters = (value) =>
  [...value].some(
    (character) =>
      character.charCodeAt(0) < 32 ||
      character.charCodeAt(0) === 127 ||
      character === "\\" ||
      character === ":",
  );
function pathName(value) {
  if (
    !value ||
    Buffer.byteLength(value) > limits.path ||
    value.startsWith("/") ||
    invalidCharacters(value) ||
    value.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw new Error("Unsafe archive path");
  return value;
}
function linkName(path, link) {
  if (
    !link ||
    link.startsWith("/") ||
    invalidCharacters(link) ||
    Buffer.byteLength(link) > limits.path
  )
    throw new Error("Unsafe archive link");
  return pathName(posix.normalize(posix.join(posix.dirname(path), link)));
}
function header(name, size, type, mode, link = "") {
  const data = Buffer.alloc(block);
  const put = (value, offset, length) => {
    if (Buffer.byteLength(value) > length) throw new Error("Archive header overflow");
    data.write(value, offset, length, "utf8");
  };
  put(name, 0, 100);
  put(`${mode.toString(8).padStart(7, "0")}\0`, 100, 8);
  put("0000000\0", 108, 8);
  put("0000000\0", 116, 8);
  put(`${size.toString(8).padStart(11, "0")}\0`, 124, 12);
  put("00000000000\0", 136, 12);
  data.fill(32, 148, 156);
  put(type, 156, 1);
  put(link, 157, 100);
  put("ustar\0", 257, 6);
  put("00", 263, 2);
  const checksum = data.reduce((a, b) => a + b, 0);
  put(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return data;
}
function paxLine(key, value) {
  const body = `${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 2;
  while (length !== Buffer.byteLength(body) + String(length).length + 1)
    length = Buffer.byteLength(body) + String(length).length + 1;
  return `${length} ${body}`;
}

// Deliberately limited USTAR + per-entry PAX path/linkpath format.
export async function writeArchive(root, destination, { signal, level = 6 } = {}) {
  async function* walk(directory, prefix = "") {
    for (const name of (await readdir(directory)).sort()) {
      signal?.throwIfAborted();
      const path = prefix ? `${prefix}/${name}` : name;
      pathName(path);
      const file = join(directory, name);
      const info = await lstat(file);
      const type = info.isDirectory()
        ? "5"
        : info.isFile()
          ? "0"
          : info.isSymbolicLink()
            ? "2"
            : null;
      if (!type) throw new Error("Unsupported payload file type");
      const link = type === "2" ? await readlink(file) : "";
      if (link) linkName(path, link);
      const extended = Buffer.from(
        `${Buffer.byteLength(path) > 100 ? paxLine("path", path) : ""}${Buffer.byteLength(link) > 100 ? paxLine("linkpath", link) : ""}`,
      );
      if (extended.length) {
        yield header("PaxHeader", extended.length, "x", 0o644);
        yield extended;
        yield Buffer.alloc((block - (extended.length % block)) % block);
      }
      yield header(
        Buffer.byteLength(path) > 100 ? "PaxEntry" : path,
        type === "0" ? info.size : 0,
        type,
        type === "5" || info.mode & 0o111 ? 0o755 : 0o644,
        Buffer.byteLength(link) > 100 ? "" : link,
      );
      if (type === "0") {
        yield* createReadStream(file);
        yield Buffer.alloc((block - (info.size % block)) % block);
      }
      if (type === "5") yield* walk(file, path);
    }
  }
  async function* contents() {
    yield* walk(root);
    yield Buffer.alloc(1024);
  }
  await pipeline(
    Readable.from(contents()),
    createGzip({ level, mtime: 0 }),
    createWriteStream(destination, { flags: "wx", mode: 0o600 }),
    { signal },
  );
}

const number = (buffer) => {
  const value = buffer.toString("ascii").replace(/\0.*$/, "").trim();
  if (!/^[0-7]+$/.test(value)) throw new Error("Malformed tar number");
  const result = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(result)) throw new Error("Oversized tar number");
  return result;
};
const string = (buffer) =>
  decoder.decode(buffer.subarray(0, buffer.indexOf(0) < 0 ? buffer.length : buffer.indexOf(0)));
async function exact(file, size, position) {
  const result = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await file.read(result, offset, size - offset, position + offset);
    if (!bytesRead) throw new Error("Truncated archive");
    offset += bytesRead;
  }
  return result;
}
function pax(bytes) {
  const values = {};
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    const lengthText = bytes.subarray(offset, space).toString("ascii");
    if (space < offset || !/^[1-9]\d*$/.test(lengthText)) throw new Error("Malformed PAX record");
    const length = Number(lengthText);
    if (
      offset + length > bytes.length ||
      length <= space - offset + 2 ||
      bytes[offset + length - 1] !== 10
    )
      throw new Error("Malformed PAX length");
    const line = decoder.decode(bytes.subarray(space + 1, offset + length - 1));
    const equal = line.indexOf("=");
    const key = line.slice(0, equal);
    if (!["path", "linkpath"].includes(key) || Object.hasOwn(values, key))
      throw new Error("Unsupported PAX field");
    values[key] = line.slice(equal + 1);
    offset += length;
  }
  return values;
}

export async function extractArchive(
  archive,
  destination,
  temporary,
  { signal, bounds = limits } = {},
) {
  let expanded = 0;
  await pipeline(
    createReadStream(archive),
    createGunzip(),
    new Transform({
      transform(chunk, _encoding, done) {
        expanded += chunk.length;
        done(
          expanded > bounds.expanded ? new Error("Archive expanded limit exceeded") : null,
          chunk,
        );
      },
    }),
    createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
    { signal },
  );
  const file = await open(temporary, "r");
  try {
    const entries = new Map();
    let position = 0;
    let extended;
    let ended = false;
    while (position < expanded) {
      signal?.throwIfAborted();
      const data = await exact(file, block, position);
      position += block;
      if (data.every((byte) => byte === 0)) {
        const second = await exact(file, block, position);
        if (second.some((byte) => byte !== 0) || extended)
          throw new Error("Malformed archive terminator");
        position += block;
        while (position < expanded) {
          if ((await exact(file, block, position)).some((byte) => byte !== 0))
            throw new Error("Trailing archive content");
          position += block;
        }
        ended = true;
        break;
      }
      const check = number(data.subarray(148, 156));
      const checksum = data.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0);
      if (check !== checksum || string(data.subarray(257, 263)) !== "ustar")
        throw new Error("Invalid tar header/checksum");
      const size = number(data.subarray(124, 136));
      const mode = number(data.subarray(100, 108));
      const type = String.fromCharCode(data[156]);
      if (size > expanded - position || mode & 0o7000) throw new Error("Unsafe tar size/mode");
      if (type === "x") {
        if (extended || size > limits.path * 3) throw new Error("Oversized/nested PAX header");
        extended = pax(await exact(file, size, position));
      } else {
        if (!["0", "5", "2"].includes(type) || (type !== "0" && size))
          throw new Error("Unsupported archive entry");
        const prefix = string(data.subarray(345, 500));
        const raw =
          extended?.path ?? `${prefix ? `${prefix}/` : ""}${string(data.subarray(0, 100))}`;
        const path = pathName(type === "5" ? raw.replace(/\/$/, "") : raw);
        if (entries.has(path) || entries.size >= bounds.entries)
          throw new Error("Duplicate/excessive archive entries");
        const link = extended?.linkpath ?? string(data.subarray(157, 257));
        if (type === "2") linkName(path, link);
        else if (link) throw new Error("Unexpected archive link");
        entries.set(path, { path, size, mode, type, link, offset: position });
        extended = undefined;
      }
      position += Math.ceil(size / block) * block;
    }
    if (!ended || !entries.size) throw new Error("Incomplete/empty archive");
    for (const entry of entries.values()) {
      for (let parent = posix.dirname(entry.path); parent !== "."; parent = posix.dirname(parent)) {
        if (entries.has(parent) && entries.get(parent).type !== "5")
          throw new Error("Archive entry nested beneath a link/file");
      }
      if (entry.type === "2") {
        let target = linkName(entry.path, entry.link);
        const seen = new Set([entry.path]);
        while (entries.get(target)?.type === "2") {
          if (seen.has(target)) throw new Error("Cyclic archive link");
          seen.add(target);
          target = linkName(target, entries.get(target).link);
        }
        if (!entries.has(target)) throw new Error("Missing archive link target");
      }
    }
    // Nothing from the archive is written until the complete inventory passes.
    await mkdir(destination, { mode: 0o700 });
    const created = new Set([destination]);
    const ensureDir = async (dir) => {
      if (created.has(dir)) return;
      await mkdir(dir, { recursive: true, mode: 0o755 });
      for (
        let current = dir;
        current !== destination && !created.has(current);
        current = dirname(current)
      )
        created.add(current);
    };
    const regularFiles = [];
    for (const entry of entries.values()) {
      signal?.throwIfAborted();
      const path = join(destination, entry.path);
      await ensureDir(dirname(path));
      if (entry.type === "5") await ensureDir(path);
      else if (entry.type === "0") regularFiles.push({ entry, path });
    }
    await runBounded(
      regularFiles,
      EXTRACT_CONCURRENCY,
      async ({ entry, path }) => {
        const mode = entry.mode & 0o111 ? 0o755 : 0o644;
        if (!entry.size) {
          await writeFile(path, Buffer.alloc(0), { flag: "wx", mode, signal });
        } else if (entry.size <= SMALL_EXTRACT_BYTES) {
          const data = await exact(file, entry.size, entry.offset);
          await writeFile(path, data, { flag: "wx", mode, signal });
        } else {
          const output = createWriteStream(path, { flags: "wx", mode });
          await pipeline(
            createReadStream(temporary, {
              start: entry.offset,
              end: entry.offset + entry.size - 1,
            }),
            output,
            { signal },
          );
        }
      },
      signal,
    );
    for (const entry of entries.values())
      if (entry.type === "2") await symlink(entry.link, join(destination, entry.path));
    return [...entries.values()];
  } finally {
    await file.close();
  }
}
