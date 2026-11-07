import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  atomicReplace,
  createPrivateFileSync,
  privateDirectory,
  verifyPrivateSync,
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
});
describe("private Windows objects", () => {
  it.runIf(process.platform === "win32")(
    "rejects a junction ancestor before creating a directory or file",
    async () => {
      const root = join(tmpdir(), `code60-junction-${randomUUID()}`);
      directories.push(root);
      await mkdir(root);
      const outside = join(root, "outside");
      await mkdir(outside);
      const junction = join(root, "junction");
      await symlink(outside, junction, "junction");
      await expect(privateDirectory(join(junction, "state"))).rejects.toThrow(/Reparse/);
      expect(() => createPrivateFileSync(join(junction, "database"))).toThrow(/Reparse/);
      await expect(readFile(join(outside, "database"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(readFile(join(outside, "state"))).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
  it.runIf(process.platform === "win32")(
    "creates real owner/SYSTEM ACLs, preserves parent ACLs and rejects unsafe existing directories",
    async () => {
      const root = join(tmpdir(), `code60-acl-${randomUUID()}`);
      directories.push(root);
      await mkdir(root);
      const privatePath = join(root, "private");
      await privateDirectory(privatePath);
      const file = join(privatePath, "record");
      await writeFile(file, "private");
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
});
