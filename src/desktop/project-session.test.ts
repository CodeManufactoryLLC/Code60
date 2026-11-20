import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { privateDirectory, verifyPrivatePath, writePrivateFile } from "../platform/index.js";
import { ProjectSessionStore } from "./project-session.js";

let directory: string;
let database: string;
let root: string;
let file: string;
let store: ProjectSessionStore;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "code60-project-session-"));
  database = join(directory, "projects.sqlite");
  root = join(directory, ".code60_workspace", "sessions");
  file = join(root, `${createHash("sha256").update(database).digest("hex")}.json`);
  store = new ProjectSessionStore(database);
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("open-project sessions", () => {
  it("treats absent legacy state as empty without creating files", async () => {
    expect(await store.load()).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
    await store.save([]);
    expect(await new ProjectSessionStore(database).load()).toEqual([]);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ format: 1, projects: [] });
  });

  it("serializes captured sets and restores 64 projects in their original order", async () => {
    const projects = Array.from({ length: 64 }, (_, i) => join(directory, `project ${i}`));
    const first = store.save([projects[0] as string]);
    const last = store.save(projects);
    projects.reverse(); // A caller cannot mutate a queued write.
    await Promise.all([first, last]);
    expect(await new ProjectSessionStore(database).load()).toEqual([...projects].reverse());
    await verifyPrivatePath(root, true);
    await verifyPrivatePath(file, false);
    expect(await readdir(root)).toEqual([file.slice(root.length + 1)]);
  });

  it("keeps two database sessions separate, including beside the same workspace", async () => {
    const other = new ProjectSessionStore(join(directory, "other.sqlite"));
    await Promise.all([store.save([join(directory, "a")]), other.save([join(directory, "b")])]);
    expect(await store.load()).toEqual([join(directory, "a")]);
    expect(await other.load()).toEqual([join(directory, "b")]);
  });

  it.each([
    { format: 2, projects: [] },
    { format: 1, projects: ["relative"] },
    { format: 1, projects: ["/invalid\0path"] },
    { format: 1, projects: ["/duplicate", "/duplicate"] },
    { format: 1, projects: Array.from({ length: 65 }, (_, i) => `/project-${i}`) },
    { format: 1, projects: [], authority: true },
  ])("preserves invalid session data: %j", async (value) => {
    await privateDirectory(root);
    const source = JSON.stringify(value);
    await writePrivateFile(file, source, { mode: 0o600, flag: "wx" });
    await expect(store.load()).rejects.toThrow();
    await expect(store.save([])).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe(source);
  });

  it("preserves malformed and oversized files and recovers the write queue after failure", async () => {
    await privateDirectory(root);
    await writePrivateFile(file, "{broken", { mode: 0o600, flag: "wx" });
    await expect(store.load()).rejects.toThrow();
    await expect(store.save([])).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("{broken");
    await writeFile(file, " ".repeat(1_048_577));
    await expect(store.load()).rejects.toThrow(/limit/);
    await expect(store.save([])).rejects.toThrow(/limit/);
    expect((await readFile(file)).length).toBe(1_048_577);
    await rm(file);
    await store.save([join(directory, "recovered")]);
    expect(await store.load()).toEqual([join(directory, "recovered")]);
  });

  it("rejects invalid writes without changing the previous set", async () => {
    await store.save([directory]);
    expect(() => store.save(["relative"])).toThrow();
    expect(() =>
      store.save(Array.from({ length: 65 }, (_, i) => join(directory, `${i}`))),
    ).toThrow();
    expect(await store.load()).toEqual([directory]);
  });

  it("rejects symlinks, directories and public files", async () => {
    await store.save([directory]);
    const outside = join(directory, "outside.json");
    await writeFile(outside, "do not change", { mode: 0o600 });
    await rm(file);
    await symlink(outside, file);
    await expect(store.load()).rejects.toThrow();
    await expect(store.save([])).rejects.toThrow();
    expect(await readFile(outside, "utf8")).toBe("do not change");
    await rm(file);
    await mkdir(file);
    await expect(store.load()).rejects.toThrow();
    await expect(store.save([])).rejects.toThrow();
    await rm(file, { recursive: true });
    await store.save([]);
    await chmod(file, 0o644);
    await expect(store.load()).rejects.toThrow();
    await expect(store.save([])).rejects.toThrow();
    await chmod(file, 0o600);
    await rm(root, { recursive: true });
    await symlink(directory, root);
    await expect(store.load()).rejects.toThrow();
    await expect(store.save([])).rejects.toThrow();
  });
});
