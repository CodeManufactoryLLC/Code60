import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  downloadProviderArtifact,
  extractProviderArchive,
} from "../src/application/provider-archive.js";
import { providerArchive } from "./fixtures/provider-artifacts.js";

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "code60-provider-archive-"));
  homes.push(home);
  return home;
}
it("verifies fixed download integrity before extraction, rejects redirects and corrupt payloads", async () => {
  const home = await fixture();
  const archive = providerArchive([{ name: "package/bin/tool", content: "executable" }]);
  const artifact = {
    url: "https://registry.npmjs.org/fixed.tgz",
    integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
  };
  const fetcher = vi.fn(async () => new Response(archive));
  await downloadProviderArtifact(
    artifact,
    join(home, "file"),
    new AbortController().signal,
    fetcher,
  );
  expect(fetcher).toHaveBeenCalledWith(
    new URL(artifact.url),
    expect.objectContaining({ redirect: "error" }),
  );
  await extractProviderArchive(join(home, "file"), join(home, "out"), new AbortController().signal);
  expect(await readFile(join(home, "out/package/bin/tool"), "utf8")).toBe("executable");
  await expect(
    downloadProviderArtifact(
      { ...artifact, integrity: "sha512-wrong" },
      join(home, "bad"),
      new AbortController().signal,
      fetcher,
    ),
  ).rejects.toThrow();
  await expect(
    downloadProviderArtifact(
      artifact,
      join(home, "unavailable"),
      new AbortController().signal,
      async () => new Response("", { status: 302 }),
    ),
  ).rejects.toThrow();
});
it.each([
  { name: "../escape", content: "bad" },
  { name: "/absolute", content: "bad" },
  { name: "link", type: "2", link: "../../escape" },
  { name: "device", type: "3" },
  { name: "hardlink", type: "1", link: "target" },
])("rejects unsafe archive entry $name without writing outside staging", async (entry) => {
  const home = await fixture();
  await writeFile(join(home, "file"), providerArchive([entry]));
  await expect(
    extractProviderArchive(join(home, "file"), join(home, "out"), new AbortController().signal),
  ).rejects.toThrow();
  expect(await readdir(home)).not.toContain("escape");
});
it("extracts contained symlinks last, rejects duplicates and truncated/corrupt headers", async () => {
  const home = await fixture();
  const file = join(home, "archive");
  await writeFile(
    file,
    providerArchive([
      { name: "bin/link", type: "2", link: "../tool" },
      { name: "tool", content: "safe" },
    ]),
  );
  await extractProviderArchive(file, join(home, "safe"), new AbortController().signal);
  expect(await readFile(join(home, "safe/bin/link"), "utf8")).toBe("safe");
  await writeFile(
    file,
    providerArchive([
      { name: "tool", content: "a" },
      { name: "tool", content: "b" },
    ]),
  );
  await expect(
    extractProviderArchive(file, join(home, "duplicate"), new AbortController().signal),
  ).rejects.toThrow();
  await writeFile(file, "not gzip");
  await expect(
    extractProviderArchive(file, join(home, "corrupt"), new AbortController().signal),
  ).rejects.toThrow();
});
