import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendPrivateFile,
  atomicReplace,
  createPrivateDirectory,
  createPrivateFileSync,
  verifyPrivateSync,
  writePrivateFile,
} from "./index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
describe("exclusive private directories", () => {
  it("reports EEXIST for synchronous private file creation without changing its contents", async () => {
    const root = await mkdtemp(join(tmpdir(), "code60-exclusive-file-"));
    directories.push(root);
    const file = join(root, "memory.sqlite");
    createPrivateFileSync(file);
    await writeFile(file, "saved database");
    expect(() => createPrivateFileSync(file)).toThrowError(
      expect.objectContaining({ code: "EEXIST" }),
    );
    expect(await readFile(file, "utf8")).toBe("saved database");
  });
  it("creates one private directory and reports EEXIST without touching an existing one", async () => {
    const root = await mkdtemp(join(tmpdir(), "code60-exclusive-"));
    directories.push(root);
    const lock = join(root, "lock");
    await createPrivateDirectory(lock);
    await writeFile(join(lock, "owner"), "first");
    await expect(createPrivateDirectory(lock)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(join(lock, "owner"), "utf8")).toBe("first");
    await expect(createPrivateDirectory(join(root, "missing", "lock"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await stat(lock)).mode & 0o077).toBe(0);
  });
});

it("preserves the destination when atomic rename fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "code60-atomic-"));
  directories.push(root);
  const old = join(root, "record");
  const next = join(root, "next");
  await writePrivateFile(old, "old", { mode: 0o600, flag: "wx" });
  await writePrivateFile(next, "next", { mode: 0o600, flag: "wx" });
  const error = new Error("disk failure");
  await expect(
    atomicReplace(next, old, async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(await readFile(old, "utf8")).toBe("old");
  await atomicReplace(next, old);
  await appendPrivateFile(old, " saved", { mode: 0o600 });
  expect(await readFile(old, "utf8")).toBe("next saved");
  expect(() => verifyPrivateSync(old)).not.toThrow();
});
