import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendPrivateFile,
  atomicReplace,
  createPrivateDirectory,
  createPrivateFileSync,
  privateDirectory,
  verifyPrivateSync,
  writePrivateFile,
} from "./index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
describe("atomic replacement", () => {
  it("retries only EBUSY, keeping the rename operation atomic", async () => {
    const busy = Object.assign(new Error("sharing violation"), { code: "EBUSY" });
    const replace = vi.fn().mockRejectedValueOnce(busy).mockResolvedValueOnce(undefined);
    await atomicReplace("temporary", "record", replace, "win32");
    expect(replace.mock.calls.map((args) => args.slice(0, 2))).toEqual([
      ["temporary", "record"],
      ["temporary", "record"],
    ]);
  });
  it("gives every attempt the full helper timeout, even late in the retry window", async () => {
    vi.useFakeTimers();
    try {
      const busy = Object.assign(new Error("sharing violation"), { code: "EBUSY" });
      const replace = vi
        .fn()
        .mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 450));
          throw busy;
        })
        .mockResolvedValueOnce(undefined);
      const done = atomicReplace("temporary", "record", replace, "win32");
      await vi.runAllTimersAsync();
      await done;
      expect(replace.mock.calls.map((args) => args[2])).toEqual([7_000, 7_000]);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each(["EACCES", "EPERM", "ENOSPC", "ENOENT"])("never retries %s", async (code) => {
    const error = Object.assign(new Error("denied"), { code });
    const replace = vi.fn().mockRejectedValue(error);
    await expect(atomicReplace("temporary", "record", replace, "win32")).rejects.toBe(error);
    expect(replace).toHaveBeenCalledTimes(1);
  });
  it("bounds persistent sharing violations to 500 ms", async () => {
    const error = Object.assign(new Error("busy"), { code: "EBUSY" });
    const started = Date.now();
    await expect(
      atomicReplace(
        "temporary",
        "record",
        async () => {
          throw error;
        },
        "win32",
      ),
    ).rejects.toBe(error);
    expect(Date.now() - started).toBeLessThan(700);
  });
  it.each(["ETIMEDOUT", "EACCES"])(
    "preserves the last sharing error only for a final helper timeout, not %s denials",
    async (code) => {
      vi.useFakeTimers();
      try {
        const busy = Object.assign(new Error("sharing violation"), { code: "EBUSY" });
        const last = Object.assign(new Error("last failure"), { code });
        const replace = vi
          .fn()
          .mockRejectedValueOnce(busy)
          .mockImplementationOnce(async () => {
            await new Promise((resolve) => setTimeout(resolve, 500));
            throw last;
          });
        const rejected = expect(atomicReplace("new", "old", replace, "win32")).rejects.toBe(
          code === "ETIMEDOUT" ? busy : last,
        );
        await vi.runAllTimersAsync();
        await rejected;
        expect(replace).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    },
  );
});
describe("exclusive private directories", () => {
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
    if (process.platform === "win32") expect(() => verifyPrivateSync(lock)).not.toThrow();
    else expect((await stat(lock)).mode & 0o077).toBe(0);
  });
});
describe("private Windows objects", () => {
  it.runIf(process.platform === "win32")(
    "rejects a junction ancestor before creating a directory or file",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "code60-junction-"));
      directories.push(root);
      const outside = join(root, "outside");
      await mkdir(outside);
      const junction = join(root, "junction");
      await symlink(outside, junction, "junction");
      await expect(privateDirectory(join(junction, "state"))).rejects.toThrow(/Reparse/);
      expect(() => createPrivateFileSync(join(junction, "database"))).toThrow(/Reparse/);
      await expect(
        writePrivateFile(join(junction, "database"), "private", { mode: 0o600, flag: "wx" }),
      ).rejects.toThrow(/Reparse/);
      await expect(
        appendPrivateFile(join(junction, "events"), "private", { mode: 0o600 }),
      ).rejects.toThrow(/Reparse/);
      await expect(readFile(join(outside, "database"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(outside, "state"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(outside, "events"))).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
  it.runIf(process.platform === "win32")(
    "creates real owner/SYSTEM ACLs, preserves parent ACLs and rejects unsafe existing directories",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "code60-acl-"));
      directories.push(root);
      const privatePath = join(root, "private");
      await privateDirectory(privatePath);
      const file = join(privatePath, "record");
      await writePrivateFile(file, "private", { mode: 0o600, flag: "wx" });
      expect(() => verifyPrivateSync(privatePath)).not.toThrow();
      expect(() => verifyPrivateSync(file)).not.toThrow();
      const unsafe = join(root, "unsafe");
      await mkdir(unsafe);
      await writeFile(join(unsafe, "preserve"), "original");
      await expect(privateDirectory(unsafe)).rejects.toThrow(/ACL|account/);
      expect(await readFile(join(unsafe, "preserve"), "utf8")).toBe("original");
      expect(() => verifyPrivateSync(root)).toThrow();
    },
  );
  it.runIf(process.platform === "win32")(
    "writes and appends private Unicode contents without replacing existing files",
    async () => {
      const parent = await mkdtemp(join(tmpdir(), "code60-private-write-"));
      directories.push(parent);
      const root = join(parent, "private");
      await privateDirectory(root);
      const file = join(root, "contents");
      const contents = "Unicode: \u{1f680}\n".repeat(10_000);
      await writePrivateFile(file, contents, { mode: 0o600, flag: "wx" });
      await appendPrivateFile(file, contents, { mode: 0o600 });
      expect(await readFile(file, "utf8")).toBe(contents + contents);
      await expect(
        writePrivateFile(file, "replacement", { mode: 0o600, flag: "wx" }),
      ).rejects.toThrow();
      expect(await readFile(file, "utf8")).toBe(contents + contents);
      expect(() => verifyPrivateSync(file)).not.toThrow();
    },
  );
});
