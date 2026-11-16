import {
  appendFile,
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TaskLoop } from "../core/index.js";
import { privateDirectory } from "../platform/index.js";
import { FolderCheckpoints } from "./folder-checkpoints.js";

let root: string;
let project: string;
let folders: FolderCheckpoints;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "code60-folder-checkpoints-")));
  project = join(root, "project");
  await mkdir(project);
  const state = join(project, "state");
  folders = new FolderCheckpoints(state, TaskLoop.folderGit(state), [state]);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
it("excludes Git and private state, preserves binary bytes and permissions, and charges before writing", async () => {
  for (const name of [".git", ".code60_workspace", "state"]) {
    await privateDirectory(join(project, name));
    await writeFile(join(project, name, "private.json"), "private");
  }
  const file = join(project, "binary");
  await writeFile(file, Buffer.from([0, 255, 1, 2]));
  await chmod(file, 0o751);
  const reserve = vi.fn(async (bytes: number) => {
    expect(bytes).toBeGreaterThan(4);
    expect(await stat(join(project, "state", "private.json"))).toBeDefined();
  });
  const saved = await folders.capture(project, 1_048_576, 33_554_432, reserve);
  expect(saved.rawBytes).toBe(4);
  expect(reserve).toHaveBeenCalledOnce();
  await writeFile(file, "modified");
  await chmod(file, 0o600);
  const { changes, rawBytes } = await folders.changes(project, saved.baseline);
  expect(rawBytes).toBe(Buffer.byteLength("modified"));
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({
    path: "binary",
    before: {
      data: Buffer.from([0, 255, 1, 2]).toString("base64"),
      // Windows exposes writable regular files without POSIX executable bits.
      mode: process.platform === "win32" ? "100644" : "100755",
      permissions: process.platform === "win32" ? 0o666 : 0o751,
    },
    after: {
      data: Buffer.from("modified").toString("base64"),
      mode: "100644",
      permissions: process.platform === "win32" ? 0o666 : 0o600,
    },
  });
  expect(await readFile(join(project, "state", "private.json"), "utf8")).toBe("private");
  expect(() => folders.loop(join(project, "state"))).toThrow("private state");
  await mkdir(join(project, "state", "..nested"));
  expect(() => folders.loop(join(project, "state", "..nested"))).toThrow("private state");
});
it("refuses links and raw-byte or storage overflow before reserving a snapshot", async () => {
  await writeFile(join(project, "file"), "12");
  const reserve = vi.fn(async () => {});
  await expect(folders.capture(project, 1_048_576, 1, reserve)).rejects.toThrow("32 MiB");
  await expect(folders.capture(project, 1, 1024, reserve)).rejects.toThrow("storage limit");
  expect(reserve).not.toHaveBeenCalled();
  await symlink(join(project, "file"), join(project, "symbolic"));
  await expect(folders.capture(project, 1_048_576, 1024, reserve)).rejects.toThrow();
  await rm(join(project, "symbolic"));
  await link(join(project, "file"), join(project, "hard"));
  await expect(folders.capture(project, 1_048_576, 1024, reserve)).rejects.toThrow("non-linked");
  expect(reserve).not.toHaveBeenCalled();
});
it("bounds current-folder reads during Undo and rejects changed private content", async () => {
  await writeFile(join(project, "file"), "before");
  const saved = await folders.capture(project, 1_048_576, 1024, async () => {});
  await writeFile(join(project, "file"), "after");
  await expect(folders.changes(project, saved.baseline, 4)).rejects.toThrow("32 MiB");
  const records = JSON.parse(
    await readFile(join(project, "state", `${saved.baseline}.json`), "utf8"),
  ) as { hash: string }[];
  await writeFile(
    join(project, "state", `${records[0]?.hash}.json`),
    JSON.stringify({ data: "eA==" }),
  );
  await expect(folders.changes(project, saved.baseline)).rejects.toThrow("content changed");
});
it("supports the full 32 MiB preimage boundary and rejects one more byte", async () => {
  const limit = 33_554_432;
  await writeFile(join(project, "large.bin"), Buffer.alloc(limit, 7));
  const reserve = vi.fn(async () => {});
  const saved = await folders.capture(project, 67_108_864, limit, reserve);
  expect(saved.rawBytes).toBe(limit);
  expect(reserve).toHaveBeenCalledOnce();
  expect(await folders.changes(project, saved.baseline)).toEqual({ changes: [], rawBytes: limit });
  await appendFile(join(project, "large.bin"), Buffer.from([8]));
  await expect(folders.capture(project, 67_108_864, limit, reserve)).rejects.toThrow();
  expect(reserve).toHaveBeenCalledOnce();
}, 10_000);
