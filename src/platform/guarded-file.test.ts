import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bindGuardedTarget,
  captureGuardedRoot,
  discardGuardedStage,
  type GuardedFileIo,
  publishGuardedFile,
  readGuardedFile,
  stageGuardedFile,
} from "./index.js";

describe("guarded configuration files", () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "code60-guarded-")));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("pins native identities above Number's safe range without rounding", async () => {
    let inode = 9007199254740993n;
    const lstat = (async (
      path: Parameters<typeof fs.lstat>[0],
      options?: Parameters<typeof fs.lstat>[1],
    ) => {
      const info = await fs.lstat(path, options);
      if (typeof info.ino === "bigint") info.ino = inode;
      return info;
    }) as typeof fs.lstat;
    const io = { ...fs, lstat };
    const captured = await captureGuardedRoot(root, io);
    expect(captured.inode).toBe("9007199254740993");
    const target = await bindGuardedTarget(root, true, io);
    inode = 9007199254740992n;
    await expect(readGuardedFile(target, 1024, io)).rejects.toMatchObject({ code: "changed" });
  });
  it("cancels replacement or removal before publication while retaining the original and owned stage", async () => {
    const path = join(root, "mcp.json");
    await fs.writeFile(path, "original", { mode: 0o600 });
    const target = await bindGuardedTarget(root, true);
    const before = await readGuardedFile(target, 1024);
    const stage = await stageGuardedFile(target, Buffer.from("replacement"), 0o600);
    const controller = new AbortController();
    controller.abort();
    for (const selected of [stage, null]) {
      await expect(
        publishGuardedFile(target, before.revision, selected, 1024, fs, controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(await fs.readFile(path, "utf8")).toBe("original");
      expect((await readGuardedFile(target, 1024)).revision).toBe(before.revision);
    }
    expect(await fs.readFile(join(root, stage.name), "utf8")).toBe("replacement");
    await discardGuardedStage(target, stage);
    expect(await fs.readdir(root)).toEqual(["mcp.json"]);
  });

  it("detects pathname replacement during a same-handle read", async () => {
    const path = join(root, "mcp.json");
    await fs.writeFile(path, "old", { mode: 0o600 });
    const target = await bindGuardedTarget(root, true);
    const lstat = (async (
      file: Parameters<typeof fs.lstat>[0],
      options?: Parameters<typeof fs.lstat>[1],
    ) => {
      if (file === path) {
        await fs.writeFile(join(root, "replacement"), "old", { mode: 0o600 });
        await fs.rename(join(root, "replacement"), path);
      }
      return fs.lstat(file, options);
    }) as typeof fs.lstat;
    await expect(readGuardedFile(target, 1024, { ...fs, lstat })).rejects.toMatchObject({
      code: "changed",
    });
  });

  it.each(["regular", "symlink", "hardlink"] as const)(
    "refuses a %s stage replacement between lstat and open without publishing it",
    async (kind) => {
      const path = join(root, "mcp.json");
      await fs.writeFile(path, "original", { mode: 0o600 });
      const target = await bindGuardedTarget(root, true);
      const before = await readGuardedFile(target, 1024);
      const stage = await stageGuardedFile(target, Buffer.from("replacement"), 0o600);
      const temporary = join(root, stage.name);
      const decoy = join(root, "decoy");
      await fs.writeFile(decoy, "replacement", { mode: 0o600 });
      let swapped = false;
      const open = (async (...args: Parameters<typeof fs.open>) => {
        if (args[0] === temporary && !swapped) {
          swapped = true;
          await fs.rename(temporary, join(root, "owned-stage"));
          if (kind === "symlink") await fs.symlink(decoy, temporary);
          else if (kind === "hardlink") await fs.link(decoy, temporary);
          else await fs.writeFile(temporary, "replacement", { mode: 0o600 });
        }
        return fs.open(...args);
      }) as typeof fs.open;
      await expect(
        publishGuardedFile(target, before.revision, stage, 1024, { ...fs, open }),
      ).rejects.toThrow();
      expect(swapped).toBe(true);
      expect(await fs.readFile(path, "utf8")).toBe("original");
      expect((await readGuardedFile(target, 1024)).revision).toBe(before.revision);
      expect(await fs.readFile(decoy, "utf8")).toBe("replacement");
      expect(await fs.readFile(join(root, "owned-stage"), "utf8")).toBe("replacement");
    },
  );

  it("removes only its own stage after a failed sync and preserves the destination", async () => {
    const path = join(root, "mcp.json");
    await fs.writeFile(path, "old", { mode: 0o600 });
    const target = await bindGuardedTarget(root, true);
    const open = (async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args);
      if (String(args[0]).endsWith(".tmp"))
        handle.sync = async () => {
          throw new Error("synthetic full disk");
        };
      return handle;
    }) as typeof fs.open;
    await expect(
      stageGuardedFile(target, Buffer.from("new"), 0o600, { ...fs, open }),
    ).rejects.toThrow("synthetic full disk");
    expect(await fs.readdir(root)).toEqual(["mcp.json"]);
    expect(await fs.readFile(path, "utf8")).toBe("old");
  });

  it("never removes replaced stages or publishes tampered/oversized stage data", async () => {
    const target = await bindGuardedTarget(root, true);
    const before = await readGuardedFile(target, 1024);
    const stage = await stageGuardedFile(target, Buffer.from("new"), 0o600);
    await fs.rename(join(root, stage.name), join(root, "original-stage"));
    await fs.writeFile(join(root, stage.name), "foreign", { mode: 0o600 });
    await expect(discardGuardedStage(target, stage)).rejects.toMatchObject({ code: "changed" });
    await expect(publishGuardedFile(target, before.revision, stage, 1024)).rejects.toMatchObject({
      code: "changed",
    });
    expect(await fs.readFile(join(root, stage.name), "utf8")).toBe("foreign");
    const huge = await stageGuardedFile(target, Buffer.alloc(1025), 0o600);
    await expect(publishGuardedFile(target, before.revision, huge, 1024)).rejects.toMatchObject({
      code: "changed",
    });
    await discardGuardedStage(target, huge);
    expect((await readGuardedFile(target, 1024)).data).toBe(null);
  });

  it("refuses group-writable managed paths and never follows a symlink anchor", async () => {
    await fs.mkdir(join(root, "writable"), { mode: 0o777 });
    await fs.chmod(join(root, "writable"), 0o777);
    await expect(bindGuardedTarget(join(root, "writable"), false)).rejects.toMatchObject({
      code: "unsafe",
    });
    await fs.symlink(root, join(root, "link"));
    await expect(bindGuardedTarget(join(root, "link"), true)).rejects.toMatchObject({
      code: "unsafe",
    });
    const target = await bindGuardedTarget(root, true);
    await expect(
      readGuardedFile({ ...target, relative: "../mcp.json" }, 1024),
    ).rejects.toMatchObject({ code: "unsafe" });
  });

  it("checks revisions again after a delayed rename boundary", async () => {
    const path = join(root, "mcp.json");
    await fs.writeFile(path, "old", { mode: 0o600 });
    const target = await bindGuardedTarget(root, true);
    const before = await readGuardedFile(target, 1024);
    const stage = await stageGuardedFile(target, Buffer.from("new"), 0o600);
    const io: GuardedFileIo = {
      ...fs,
      checkpoint: async (step) => {
        if (step === "rename") await fs.writeFile(path, "external edit");
      },
    };
    await expect(
      publishGuardedFile(target, before.revision, stage, 1024, io),
    ).rejects.toMatchObject({ code: "changed" });
    expect(await fs.readFile(path, "utf8")).toBe("external edit");
    await discardGuardedStage(target, stage);
  });
});
