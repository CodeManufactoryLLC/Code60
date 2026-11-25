import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { verifyArtifactHandoff } from "../scripts/verify-artifact-handoff.mjs";

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "code60 artifact handoff ' spaces "));
  roots.push(root);
  const bytes = Buffer.from(
    "synthetic archive: handoff verifies bytes, acceptance verifies extraction",
  );
  const name = "code60-0.4.1-linux-x64.tar.gz";
  const value = {
    schemaVersion: 1,
    version: "0.4.1",
    commit: "a".repeat(40),
    dirty: false,
    os: "linux",
    arch: "x64",
    runtime: { node: ">=24.22.0 <25", libc: "glibc" },
    archive: {
      name,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      url: `https://github.com/CodeManufactoryLLC/Code60/releases/download/v0.4.1/${name}`,
    },
    extra: "private metadata must never be exported",
  };
  const path = join(root, "descriptor.json");
  await writeFile(path, JSON.stringify(value));
  await writeFile(join(root, name), bytes);
  return {
    root,
    path,
    value,
    archive: join(root, name),
    expected: { commit: value.commit, version: value.version, target: "linux-x64" },
  };
}
it("pins exact source/version/platform and archive bytes across a same-run artifact handoff", async () => {
  const f = await fixture();
  const result = await verifyArtifactHandoff(f.path, f.expected);
  expect(result).toMatchObject({ schemaVersion: 1, ...f.expected, archive: f.value.archive });
  expect(JSON.stringify(result)).not.toContain("private metadata");
  for (const patch of [
    { commit: "b".repeat(40) },
    { version: "0.4.2" },
    { target: "darwin-arm64" },
  ])
    await expect(verifyArtifactHandoff(f.path, { ...f.expected, ...patch })).rejects.toThrow(
      "clean selected source/platform",
    );
  await writeFile(f.path, JSON.stringify({ ...f.value, dirty: true }));
  await expect(verifyArtifactHandoff(f.path, f.expected)).rejects.toThrow(
    "clean selected source/platform",
  );
  expect(await readFile(f.archive)).toHaveLength(f.value.archive.size);
});
it("refuses invalid metadata, corrupt/missing archives, unsafe file types and cancellation", async () => {
  const f = await fixture();
  for (const value of [
    "private123: broken JSON",
    "x".repeat(16385),
    JSON.stringify({ ...f.value, archive: { ...f.value.archive, name: "../unowned" } }),
  ]) {
    await writeFile(f.path, value);
    await expect(verifyArtifactHandoff(f.path, f.expected)).rejects.toThrow(/invalid|bounded/);
  }
  await writeFile(f.path, JSON.stringify(f.value));
  await writeFile(f.archive, "x".repeat(f.value.archive.size));
  await expect(verifyArtifactHandoff(f.path, f.expected)).rejects.toThrow("checksum mismatch");
  await writeFile(f.archive, "short");
  await expect(verifyArtifactHandoff(f.path, f.expected)).rejects.toThrow("size mismatch");
  await rm(f.archive);
  await expect(verifyArtifactHandoff(f.path, f.expected)).rejects.toMatchObject({ code: "ENOENT" });
  await mkdir(f.archive);
  await expect(verifyArtifactHandoff(f.path, f.expected)).rejects.toThrow("bounded regular files");
  await rm(f.archive, { recursive: true });
  const actual = join(f.root, "actual");
  await writeFile(actual, "x");
  await symlink(actual, f.archive);
  await expect(verifyArtifactHandoff(f.path, f.expected)).rejects.toMatchObject({ code: "ELOOP" });
  await rm(f.archive);
  await link(actual, f.archive);
  await expect(verifyArtifactHandoff(f.path, f.expected)).rejects.toThrow("without links");
  await expect(verifyArtifactHandoff(f.path, { ...f.expected, commit: "main" })).rejects.toThrow(
    "selected source commit",
  );
  await expect(
    verifyArtifactHandoff(f.path, { ...f.expected, signal: AbortSignal.abort() }),
  ).rejects.toThrow();
});
it("rejects CLI arguments before reading source/artifacts", async () => {
  await expect(
    promisify(execFile)(
      process.execPath,
      [resolve("scripts/verify-artifact-handoff.mjs"), "--unknown"],
      { timeout: 10000 },
    ),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("Use npm run verify:artifact"),
  });
});
