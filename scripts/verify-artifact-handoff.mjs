// Verify a CI payload handoff without importing development dist or executing it.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runCommand } from "./distribution/command.mjs";
import { descriptor, platform } from "./distribution/descriptor.mjs";

const execute = promisify(execFile);
const sameFile = (a, b) =>
  ["dev", "ino", "size", "ctimeNs", "mtimeNs", "nlink"].every((key) => a[key] === b[key]);
async function checkedFile(path, maximum, signal, consume) {
  signal?.throwIfAborted();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const start = await file.stat({ bigint: true });
    if (!start.isFile() || start.nlink !== 1n || start.size > BigInt(maximum))
      throw Error("Artifact handoff requires bounded regular files without links");
    const result = await consume(file, Number(start.size));
    if (
      !sameFile(start, await file.stat({ bigint: true })) ||
      !sameFile(start, await lstat(path, { bigint: true }))
    )
      throw Error("Artifact handoff changed during verification");
    return result;
  } finally {
    await file.close();
  }
}

export async function verifyArtifactHandoff(input, { commit, version, target, signal }) {
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw Error("Artifact handoff requires the selected source commit and version");
  const value = await checkedFile(input, 16384, signal, async (file, size) => {
    const bytes = Buffer.alloc(size + 1);
    let count = 0;
    for (;;) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(bytes, count, bytes.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
      if (count > size) throw Error("Artifact descriptor changed during verification");
    }
    if (count !== size) throw Error("Artifact descriptor changed during verification");
    try {
      return descriptor(
        JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes.subarray(0, count))),
      );
    } catch {
      throw Error("Artifact handoff descriptor is invalid");
    }
  });
  if (
    value.commit !== commit ||
    value.version !== version ||
    value.dirty ||
    `${value.os}-${value.arch}` !== target
  )
    throw Error("Artifact handoff does not match the clean selected source/platform");
  const archive = join(dirname(input), value.archive.name);
  const actual = await checkedFile(archive, value.archive.size, signal, async (file, size) => {
    if (size !== value.archive.size) throw Error("Artifact handoff archive size mismatch");
    const hash = createHash("sha256");
    let count = 0;
    for await (const bytes of file.createReadStream({ autoClose: false, signal })) {
      count += bytes.length;
      if (count > value.archive.size) throw Error("Artifact handoff archive size mismatch");
      hash.update(bytes);
    }
    if (count !== value.archive.size || hash.digest("hex") !== value.archive.sha256)
      throw Error("Artifact handoff archive checksum mismatch");
    return count;
  });
  // Only public descriptor fields leave this boundary; unknown metadata is not evidence.
  return {
    schemaVersion: 1,
    commit,
    version,
    target,
    node: process.versions.node,
    archive: {
      name: value.archive.name,
      size: actual,
      sha256: value.archive.sha256,
      url: value.archive.url,
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCommand(async (cancel) => {
    const args = process.argv.slice(2);
    if (args.length !== 1 || args[0].startsWith("-"))
      throw Error("Use npm run verify:artifact -- <descriptor.json>");
    const root = fileURLToPath(new URL("..", import.meta.url));
    const signal = AbortSignal.any([cancel, AbortSignal.timeout(120000)]);
    const options = { cwd: root, signal, timeout: 10000, maxBuffer: 1024 ** 2 };
    const [commit, changes, manifest] = await Promise.all([
      execute("git", ["rev-parse", "HEAD"], options),
      execute("git", ["status", "--porcelain", "--untracked-files=normal"], options),
      readFile(join(root, "package.json"), "utf8"),
    ]);
    if (changes.stdout.trim()) throw Error("Artifact handoff requires a clean source checkout");
    const result = await verifyArtifactHandoff(resolve(root, args[0]), {
      commit: commit.stdout.trim(),
      version: JSON.parse(manifest).version,
      target: platform(),
      signal,
    });
    const evidence = join(root, "test-results/artifact-handoff", `${Date.now()}-${process.pid}`);
    await mkdir(evidence, { recursive: true, mode: 0o700 });
    await writeFile(join(evidence, "result.json"), JSON.stringify(result, null, 2), {
      mode: 0o600,
    });
    console.log(`Artifact handoff verified: ${result.archive.name} (${result.archive.sha256})`);
  });
}
