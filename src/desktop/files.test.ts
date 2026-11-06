import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFileContext } from "../bridge/index.js";
import { previewByteLimit, readFiles } from "./files.js";

let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "code60-files-")));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const context = (preview: string | null = null, directories = [""]) => ({
  project: root,
  root,
  directories,
  preview,
});

describe("scoped file browsing", () => {
  it("reads only requested directories and previews empty or UTF-8 files", async () => {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "main.ts"), "const café = 1;\n");
    await writeFile(join(root, "empty"), "");
    const first = await readFiles(context("empty"), () => true);
    expect(first.directories).toHaveLength(1);
    expect(first.directories[0]?.entries.map((entry) => entry.name)).toEqual(["src", "empty"]);
    expect(first.preview).toMatchObject({ text: "", size: 0, error: null });
    const expanded = await readFiles(context("src/main.ts", ["", "src"]), () => true);
    expect(expanded.directories[1]?.entries[0]?.path).toBe("src/main.ts");
    expect(expanded.preview?.text).toBe("const café = 1;\n");
  });
  it("rejects traversal, absolute paths, unknown fields and unbounded requests", () => {
    for (const path of ["../outside", "/etc/passwd", "a/../b", "a//b", "a\\b", "a\0b", "."])
      expect(() => parseFileContext(context(path))).toThrow();
    expect(() => parseFileContext({ ...context(), command: "bad" })).toThrow();
    expect(() => parseFileContext(context(null, Array(65).fill("")))).toThrow();
    expect(() => parseFileContext(context(null, ["a"]))).toThrow();
  });
  it("does not follow file or directory symlinks or block on special files", async () => {
    await writeFile(join(root, "secret"), "secret");
    await symlink(join(root, "secret"), join(root, "link"));
    await symlink(root, join(root, "dir-link"));
    execFileSync("mkfifo", [join(root, "fifo")]);
    for (const path of ["link", "dir-link/secret", "fifo"]) {
      const result = await readFiles(context(path), () => true);
      expect(result.preview?.text).toBeNull();
      expect(result.preview?.error).toMatch(/links|regular files/);
    }
    const result = await readFiles(context(null, ["", "dir-link"]), () => true);
    expect(result.directories[1]?.error).toMatch(/links/);
  });
  it("bounds previews and reports binary, encoding, and missing-file errors", async () => {
    await writeFile(join(root, "large"), Buffer.alloc(previewByteLimit + 1, 65));
    await writeFile(join(root, "binary"), Buffer.from([0, 1]));
    await writeFile(join(root, "encoding"), Buffer.from([255]));
    for (const [path, error] of [
      ["large", /1 MiB/],
      ["binary", /binary/],
      ["encoding", /UTF-8/],
      ["missing", /ENOENT/],
    ] as const) {
      const result = await readFiles(context(path), () => true);
      expect(result.preview?.text).toBeNull();
      expect(result.preview?.error).toMatch(error);
    }
  });
  it("reports partial directory failures and caps large directory listings", async () => {
    for (let batch = 0; batch < 21; batch++) {
      await Promise.all(
        Array.from({ length: 100 }, (_, index) =>
          writeFile(join(root, `file-${batch}-${index}`), ""),
        ),
      );
    }
    const result = await readFiles(context(null, ["", "missing"]), () => true);
    expect(result.directories[0]?.entries).toHaveLength(2000);
    expect(result.directories[0]?.truncated).toBe(true);
    expect(result.directories[1]?.error).toMatch(/ENOENT/);
  });
  it("refuses a root that has been replaced by a symbolic link", async () => {
    const target = join(root, "target");
    const link = join(root, "link");
    await mkdir(target);
    await symlink(target, link);
    await expect(readFiles({ ...context(), root: link }, () => true)).rejects.toThrow(
      /symbolic link/,
    );
  });

  it("stops between reads when the context is no longer current", async () => {
    const result = await readFiles(context("missing"), () => false);
    expect(result.directories).toEqual([]);
    expect(result.preview).toBeNull();
  });
});
