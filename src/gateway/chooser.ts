import { randomUUID } from "node:crypto";
import { lstat, mkdir, opendir, realpath } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import type { Choices, PickKind } from "../bridge/index.js";

type Selection = { path: string; device: bigint; inode: bigint; directory: boolean };
const filename = (name: string) => {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    [...name].some((character) => (character.codePointAt(0) ?? 0) < 32) ||
    /[/\\]/.test(name)
  )
    throw new Error("Use a filename without path separators.");
  return name;
};
const contained = (root: string, path: string) => {
  const child = relative(root, path);
  return (
    child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !child.startsWith(sep))
  );
};

/** A chooser owns its opaque selections. Paths from the browser are never accepted. */
export class HostChooser {
  private readonly selections = new Map<string, Selection>();
  private roots: string[] = [];
  constructor(
    private readonly configuredRoots: readonly string[],
    readonly kind: PickKind,
  ) {}

  private async capture(path: string): Promise<string> {
    const canonical = await realpath(path);
    if (!this.roots.some((root) => contained(root, canonical)))
      throw new Error("This selection is outside the configured workspace roots.");
    const info = await lstat(canonical, { bigint: true });
    if (!info.isDirectory() && !info.isFile()) throw new Error("Unsupported selection.");
    if (this.selections.size >= 4096)
      throw new Error("Chooser limit reached. Open the chooser again.");
    const id = randomUUID();
    this.selections.set(id, {
      path: canonical,
      device: info.dev,
      inode: info.ino,
      directory: info.isDirectory(),
    });
    return id;
  }

  private async selection(id: string): Promise<Selection> {
    const selected = this.selections.get(id);
    if (!selected) throw new Error("Selection expired. Choose it again.");
    const canonical = await realpath(selected.path);
    const info = await lstat(canonical, { bigint: true });
    if (
      canonical !== selected.path ||
      info.dev !== selected.device ||
      info.ino !== selected.inode ||
      info.isDirectory() !== selected.directory
    )
      throw new Error("Selection changed. Choose it again.");
    // Recheck containment, including a replaced ancestor, after every await.
    if (!this.roots.some((root) => contained(root, canonical)))
      throw new Error("Selection is outside the workspace roots.");
    return selected;
  }

  async list(id?: string, createDirectory?: string): Promise<Choices> {
    if (!this.roots.length) {
      this.roots = await Promise.all(this.configuredRoots.map((root) => realpath(root)));
    }
    if (!id)
      return {
        directory: "Workspace roots",
        truncated: false,
        entries: await Promise.all(
          this.roots.map(async (root) => ({
            id: await this.capture(root),
            name: root,
            directory: true,
          })),
        ),
      };
    let selected = await this.selection(id);
    if (!selected.directory) throw new Error("Choose a directory.");
    if (createDirectory) {
      const path = join(selected.path, filename(createDirectory));
      await mkdir(path, { mode: 0o700 });
      selected = await this.selection(await this.capture(path));
    }
    const entries: Choices["entries"] = [];
    const parent = dirname(selected.path);
    if (this.roots.some((root) => contained(root, parent))) {
      entries.push({ id: await this.capture(parent), name: "..", directory: true });
    }
    const directory = await opendir(selected.path);
    let truncated = false;
    let examined = 0;
    for await (const entry of directory) {
      if (++examined > 2000 || entries.length >= 200) {
        truncated = true;
        break;
      }
      if (
        entry.isSymbolicLink() ||
        (!entry.isDirectory() &&
          !(this.kind === "database-open" && /\.(?:db|sqlite3?)$/i.test(entry.name)))
      )
        continue;
      try {
        entries.push({
          id: await this.capture(join(selected.path, entry.name)),
          name: entry.name,
          directory: entry.isDirectory(),
        });
      } catch {
        /* Replaced and out-of-root entries are not selectable. */
      }
    }
    await this.selection(id);
    // Include the current directory as a selectable entry without trusting a display path.
    entries.unshift({ id: await this.capture(selected.path), name: ".", directory: true });
    return {
      directory: selected.path,
      entries: entries.sort(
        (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name),
      ),
      truncated,
    };
  }

  async resolve(id: string, name?: string): Promise<string> {
    const selected = await this.selection(id);
    if (this.kind === "folder") {
      if (!selected.directory || name) throw new Error("Choose a folder.");
      return selected.path;
    }
    if (this.kind === "database-open") {
      if (selected.directory || name) throw new Error("Choose a database file.");
      return selected.path;
    }
    if (!selected.directory || !name) throw new Error("Choose a folder and database filename.");
    const target = join(selected.path, filename(name));
    const exists = await lstat(target).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return false;
      },
    );
    if (exists)
      throw new Error(`A file named ${basename(target)} already exists. Open it instead.`);
    await this.selection(id);
    return target;
  }
}
