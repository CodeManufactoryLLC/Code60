import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  inventoryInstallationRemoval,
  removeInstallationInventory,
} from "./installation-removal.js";

const roots: string[] = [];
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), "code60 remove ' spaces ")));
  roots.push(home);
  const root = join(home, "release");
  await mkdir(join(root, "nested"), { recursive: true, mode: 0o700 });
  await writeFile(join(root, "nested/binary"), Buffer.from([0, 255, 195, 40]), { mode: 0o600 });
  await writeFile(join(root, "keep-until-owned"), "installed", { mode: 0o600 });
  await symlink("nested/binary", join(root, "binary-link"));
  await writeFile(join(home, "database.sqlite"), "customer bytes", { mode: 0o600 });
  return { root, home };
}
it("removes exactly inventoried files and contained links without touching adjacent customer state", async () => {
  const f = await fixture();
  const inventory = await inventoryInstallationRemoval(f.root);
  expect(inventory.entries.find((entry) => entry.path === "nested/binary")).toMatchObject({
    type: "file",
    size: 4,
  });
  await removeInstallationInventory(f.root, JSON.parse(JSON.stringify(inventory)));
  await expect(lstat(f.root)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(f.home, "database.sqlite"), "utf8")).toBe("customer bytes");
  await removeInstallationInventory(f.root, inventory);
});
it.each(["file", "addition", "directory", "hardlink", "link"])(
  "refuses changed %s before deleting any remaining contents",
  async (change) => {
    const f = await fixture();
    const inventory = await inventoryInstallationRemoval(f.root);
    if (change === "file") await writeFile(join(f.root, "nested/binary"), "changed");
    if (change === "addition") await writeFile(join(f.root, "foreign"), "outside edit");
    if (change === "directory") {
      await rename(join(f.root, "nested"), join(f.home, "original"));
      await mkdir(join(f.root, "nested"), { mode: 0o700 });
    }
    if (change === "hardlink")
      await link(join(f.root, "nested/binary"), join(f.home, "outside-link"));
    if (change === "link") {
      await rm(join(f.root, "binary-link"));
      await symlink("../database.sqlite", join(f.root, "binary-link"));
    }
    await expect(removeInstallationInventory(f.root, inventory)).rejects.toThrow();
    expect(await readFile(join(f.root, "keep-until-owned"), "utf8")).toBe("installed");
  },
);
it("resumes an interrupted removal without reclaiming new resources", async () => {
  const f = await fixture();
  const inventory = await inventoryInstallationRemoval(f.root);
  let count = 0;
  await expect(
    removeInstallationInventory(f.root, inventory, {
      checkpoint: async () => {
        if (++count === 3) throw Error("injected cleanup interruption");
      },
    }),
  ).rejects.toThrow("injected cleanup interruption");
  expect((await readdir(f.root)).length).toBeGreaterThan(0);
  await removeInstallationInventory(f.root, inventory);
  await expect(lstat(f.root)).rejects.toMatchObject({ code: "ENOENT" });
});
it("honors cancellation before mutation and during cleanup", async () => {
  const f = await fixture();
  const inventory = await inventoryInstallationRemoval(f.root);
  const abort = new AbortController();
  abort.abort(Error("cancelled"));
  await expect(inventoryInstallationRemoval(f.root, abort.signal)).rejects.toThrow("cancelled");
  await expect(
    removeInstallationInventory(f.root, inventory, { signal: abort.signal }),
  ).rejects.toThrow("cancelled");
  expect(await readFile(join(f.root, "keep-until-owned"), "utf8")).toBe("installed");
  const during = new AbortController();
  await expect(
    removeInstallationInventory(f.root, inventory, {
      signal: during.signal,
      checkpoint: async () => {
        during.abort(Error("during"));
      },
    }),
  ).rejects.toThrow("during");
  await removeInstallationInventory(f.root, inventory);
});
it.each(["../database.sqlite", "/etc/passwd", "nested//binary", "nested/./binary", "bad\npath"])(
  "rejects an unsafe journal path %j without touching the destination",
  async (path) => {
    const f = await fixture();
    const inventory = await inventoryInstallationRemoval(f.root);
    const entry = inventory.entries[1];
    if (!entry) throw Error("Fixture inventory missing");
    inventory.entries[1] = { ...entry, path };
    await expect(removeInstallationInventory(f.root, inventory)).rejects.toThrow("ownership");
    expect(await readFile(join(f.root, "keep-until-owned"), "utf8")).toBe("installed");
  },
);
it("rejects duplicate entries, nested links and inventories belonging to another root", async () => {
  const f = await fixture();
  const inventory = await inventoryInstallationRemoval(f.root);
  await expect(removeInstallationInventory(f.home, inventory)).rejects.toThrow("ownership");
  const first = inventory.entries[0];
  if (!first) throw Error("Fixture root missing");
  await expect(
    removeInstallationInventory(f.root, {
      ...inventory,
      entries: [...inventory.entries, first],
    }),
  ).rejects.toThrow("ownership");
  const linkEntry = inventory.entries.find((entry) => entry.type === "link");
  if (!linkEntry) throw Error("Fixture link missing");
  await expect(
    removeInstallationInventory(f.root, {
      ...inventory,
      entries: [...inventory.entries, { ...linkEntry, path: "binary-link/child" }],
    }),
  ).rejects.toThrow("ownership");
});
it("rechecks ownership at each deletion checkpoint", async () => {
  const f = await fixture();
  const inventory = await inventoryInstallationRemoval(f.root);
  await expect(
    removeInstallationInventory(f.root, inventory, {
      checkpoint: async (path) => {
        if (path === "nested/binary")
          await writeFile(join(f.root, path), "outside concurrent change");
      },
    }),
  ).rejects.toThrow("ownership");
  expect(await readFile(join(f.root, "nested/binary"), "utf8")).toBe("outside concurrent change");
});
