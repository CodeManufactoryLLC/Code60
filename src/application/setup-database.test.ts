import {
  link,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { filePreferences } from "./preferences.js";
import { openProjectDatabase } from "./projects.js";
import { inspectSetupDatabase, prepareSetupDatabase, setupDatabasePath } from "./setup-database.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), "code60 setup ' database ")));
  roots.push(home);
  const env = { HOME: home };
  const file = join(home, "preferences.json");
  return { home, env, file, prefs: filePreferences(file), path: setupDatabasePath(env) };
}
it("creates an owned default once, remembers it and leaves healthy data unchanged on repeat", async () => {
  const f = await fixture();
  await writeFile(f.file, JSON.stringify({ updateCheck: false }), { mode: 0o600 });
  expect(await prepareSetupDatabase(f.env, f.prefs)).toBe(f.path);
  expect((await readFile(f.path)).subarray(0, 16).toString()).toBe("SQLite format 3\0");
  expect((await lstat(f.path)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(f.file, "utf8"))).toEqual({
    updateCheck: false,
    database: f.path,
  });
  const before = await lstat(f.path);
  const preferences = await lstat(f.file);
  await prepareSetupDatabase(f.env, f.prefs, f.path);
  expect((await lstat(f.path)).mtimeMs).toBe(before.mtimeMs);
  expect((await lstat(f.file)).mtimeMs).toBe(preferences.mtimeMs);
  expect((await readdir(join(f.home, ".local/share/code60/databases"))).sort()).toEqual([
    ".code60_workspace",
    "default.sqlite",
  ]);
});
it("uses absolute XDG data and adopts a validated interrupted default", async () => {
  const f = await fixture();
  const env = { ...f.env, XDG_DATA_HOME: join(f.home, "data with spaces") };
  const path = await prepareSetupDatabase(env, f.prefs);
  await rm(f.file);
  const before = await readFile(path);
  expect(await prepareSetupDatabase(env, f.prefs)).toBe(path);
  expect(await readFile(path)).toEqual(before);
  expect(() => setupDatabasePath({ ...f.env, XDG_DATA_HOME: "relative" })).toThrow("absolute");
});
it.each(["{", "[]", "null", '{"database":null}', '{"database":"relative"}'])(
  "preserves damaged selection metadata %s",
  async (text) => {
    const f = await fixture();
    await writeFile(f.file, text, { mode: 0o600 });
    await expect(prepareSetupDatabase(f.env, f.prefs)).rejects.toThrow();
    expect(await readFile(f.file, "utf8")).toBe(text);
    await expect(lstat(f.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
it("preserves a valid custom selection and refuses missing selections without fallback", async () => {
  const f = await fixture();
  const custom = join(f.home, "custom.sqlite");
  openProjectDatabase(custom, true).close();
  await f.prefs.write(custom);
  expect(await prepareSetupDatabase(f.env, f.prefs)).toBe(custom);
  await rm(custom);
  await expect(prepareSetupDatabase(f.env, f.prefs)).rejects.toThrow();
  await expect(lstat(f.path)).rejects.toMatchObject({ code: "ENOENT" });
});
it.each(["empty", "unrelated", "corrupt", "newer", "symlink", "hardlink"])(
  "never modifies an unsafe existing selection: %s",
  async (mode) => {
    const f = await fixture();
    const path = join(f.home, "chosen.sqlite");
    if (mode === "empty") new DatabaseSync(path).close();
    if (mode === "unrelated") {
      const db = new DatabaseSync(path);
      db.exec("CREATE TABLE unrelated(value TEXT)");
      db.close();
    }
    if (mode === "corrupt") await writeFile(path, "not a database");
    if (mode === "newer" || mode === "symlink" || mode === "hardlink") {
      openProjectDatabase(path, true).close();
      if (mode === "newer") {
        const db = new DatabaseSync(path);
        db.exec("UPDATE code60_meta SET value='999' WHERE key='schema'");
        db.close();
      } else {
        const original = join(f.home, "original.sqlite");
        const { rename } = await import("node:fs/promises");
        await rename(path, original);
        if (mode === "symlink") await symlink(original, path);
        else await link(original, path);
      }
    }
    await f.prefs.write(path);
    const before = await readFile(path);
    const prefs = await readFile(f.file);
    await expect(prepareSetupDatabase(f.env, f.prefs)).rejects.toThrow();
    expect(await readFile(path)).toEqual(before);
    expect(await readFile(f.file)).toEqual(prefs);
  },
);
it("refuses live database replacement and detects concurrent preference edits", async () => {
  const f = await fixture();
  const other = join(f.home, "other.sqlite");
  openProjectDatabase(other, true).close();
  await expect(prepareSetupDatabase(f.env, f.prefs, other)).rejects.toThrow("connected");
  const commit = f.prefs.selectInitial;
  if (!commit) throw Error("Expected strict preferences");
  f.prefs.selectInitial = async (path, identity) => {
    await f.prefs.write(other);
    return commit(path, identity);
  };
  await expect(prepareSetupDatabase(f.env, f.prefs)).rejects.toThrow("changed");
  expect(await f.prefs.read()).toBe(other);
  await inspectSetupDatabase(f.path);
});
