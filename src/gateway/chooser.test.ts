import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { HostChooser } from "./chooser.js";

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
it("contains selections, rejects traversal and detects replacement", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "code60-chooser-")));
  directories.push(root);
  const home = join(root, "home");
  await mkdir(home);
  await mkdir(join(root, "outside"));
  await symlink(join(root, "outside"), join(home, "escape"));
  const chooser = new HostChooser([home], "database-create");
  const choice = (await chooser.list()).entries[0];
  expect(choice).toBeDefined();
  const page = await chooser.list(choice?.id);
  expect(page.entries.map((entry) => entry.name)).not.toContain("escape");
  const selected = page.entries.find((entry) => entry.name === ".");
  await expect(chooser.resolve(selected?.id ?? "", "../outside/stolen.sqlite")).rejects.toThrow(
    "filename",
  );
  await writeFile(join(home, "existing.sqlite"), "keep");
  await expect(chooser.resolve(selected?.id ?? "", "existing.sqlite")).rejects.toThrow(
    "already exists",
  );
  await rename(home, `${home}-old`);
  await mkdir(home);
  await expect(chooser.resolve(selected?.id ?? "", "new.sqlite")).rejects.toThrow("changed");
});
it("creates folders through captured directory identities and selects database files", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "code60-chooser-")));
  directories.push(root);
  const chooser = new HostChooser([root], "database-open");
  const home = (await chooser.list()).entries[0];
  const listing = await chooser.list(home?.id, "project");
  expect(listing.directory).toBe(join(root, "project"));
  await writeFile(join(root, "project", "code.sqlite"), "fixture");
  const current = listing.entries.find((entry) => entry.name === ".");
  const file = (await chooser.list(current?.id)).entries.find(
    (entry) => entry.name === "code.sqlite",
  );
  expect(await chooser.resolve(file?.id ?? "")).toBe(join(root, "project", "code.sqlite"));
});
