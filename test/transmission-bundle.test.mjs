import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  buildTransmission,
  stripTransmissionPackageIgnores,
  transmissionArtifacts,
  verifyTransmissionLock,
} from "../scripts/distribution/transmission.mjs";
import { LEGACY_TRANSMISSION_VERSION, TRANSMISSION_VERSION } from "../src/contracts/index.js";

const source = new URL("../distribution/transmission/package-lock.json", import.meta.url);
it("locks both original engine artifacts and every dependency without install hooks", async () => {
  const lock = JSON.parse(await readFile(source, "utf8"));
  expect(() => verifyTransmissionLock(lock)).not.toThrow();
  expect(Object.keys(transmissionArtifacts)).toEqual([
    LEGACY_TRANSMISSION_VERSION,
    TRANSMISSION_VERSION,
  ]);
  for (const version of Object.keys(transmissionArtifacts)) {
    const copy = structuredClone(lock);
    copy.packages[`node_modules/${transmissionArtifacts[version].name}`].integrity = "sha512-wrong";
    expect(() => verifyTransmissionLock(copy)).toThrow("verified supported artifacts");
  }
});
it.each(["hasInstallScript", "resolved", "integrity", "version"])(
  "rejects unsafe dependency lock field %s",
  async (field) => {
    const lock = JSON.parse(await readFile(source, "utf8"));
    lock.packages["node_modules/@openai/codex"][field] =
      field === "hasInstallScript" ? true : "invalid";
    expect(() => verifyTransmissionLock(lock)).toThrow();
  },
);
it("rejects unsupported and cross-target builds before creating files", async () => {
  await expect(
    buildTransmission("/missing", "/must-not-write", {
      host: { platform: "freebsd", arch: "x64" },
    }),
  ).rejects.toThrow("natively");
});
it("omits npm-rewritten metadata before recording the shared runtime inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "code60 engine metadata ' "));
  try {
    const nested = join(root, "nested dependency");
    await mkdir(nested);
    for (const name of [".npmignore", ".gitignore", "runtime.js", "LICENSE"])
      await writeFile(join(nested, name), name);
    await stripTransmissionPackageIgnores(root);
    expect((await readdir(nested)).sort()).toEqual(["LICENSE", "runtime.js"]);
    expect(await readFile(join(nested, "runtime.js"), "utf8")).toBe("runtime.js");
  } finally {
    await rm(root, { recursive: true });
  }
});

it("pins the Linux engine tarball and rejects changes to its integrity", async () => {
  const { createHash } = await import("node:crypto");
  const { linuxEngines } = await import("../src/platform/transmission-target.mjs");
  const root = new URL("../distribution/transmission-linux/", import.meta.url);
  const lock = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));
  verifyTransmissionLock(lock, linuxEngines);
  const artifact = lock.packages["node_modules/code60-transmission-server"];
  const bytes = await readFile(new URL(artifact.resolved.slice(5), root));
  expect("sha512-" + createHash("sha512").update(bytes).digest("base64")).toBe(artifact.integrity);
  artifact.integrity = "sha512-changed";
  expect(() => verifyTransmissionLock(lock, linuxEngines)).toThrow("verified supported artifacts");
});
