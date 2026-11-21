import type { FileDirectory } from "../bridge/index.js";

export interface FileBookmark {
  path: string;
  kind: "file" | "directory";
}
const bookmarkLimit = 100;
export const bookmarkKey = (project: string) => `code60.fileBookmarks.v1:${project}`;

function validBookmark(value: unknown): value is FileBookmark {
  if (!value || typeof value !== "object") return false;
  const { path, kind } = value as FileBookmark;
  return (
    (kind === "file" || kind === "directory") &&
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 4096 &&
    !/[\\:]/.test(path) &&
    [...path].every((character) => character.charCodeAt(0) >= 32) &&
    path.split("/").length <= 60 &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

export function readBookmarks(storage: Pick<Storage, "getItem">, project: string): FileBookmark[] {
  const raw = storage.getItem(bookmarkKey(project));
  if (raw === null) return [];
  if (raw.length > 450_000) throw new Error("Saved bookmarks are too large.");
  const value: unknown = JSON.parse(raw);
  if (
    !Array.isArray(value) ||
    value.length > bookmarkLimit ||
    !value.every(validBookmark) ||
    new Set(value.map((item) => item.path)).size !== value.length
  )
    throw new Error("Saved bookmarks are invalid.");
  return value;
}

export function writeBookmarks(
  storage: Pick<Storage, "setItem">,
  project: string,
  entries: FileBookmark[],
) {
  if (entries.length > bookmarkLimit) throw new Error("Bookmark limit reached (100 per project).");
  if (
    !entries.every(validBookmark) ||
    new Set(entries.map((item) => item.path)).size !== entries.length
  )
    throw new Error("This target cannot be bookmarked.");
  storage.setItem(bookmarkKey(project), JSON.stringify(entries));
}

export function bookmarkDirectories(bookmark: FileBookmark): string[] {
  const parts = bookmark.path.split("/");
  return parts
    .slice(0, bookmark.kind === "directory" ? undefined : -1)
    .map((_, index) => parts.slice(0, index + 1).join("/"));
}

/** Every ancestor must be a listed regular directory; never follow a replacement link. */
export function bookmarkAvailable(bookmark: FileBookmark, directories: FileDirectory[]): boolean {
  const parts = bookmark.path.split("/");
  return (
    parts.every((_, index) => {
      const parent = directories.find((dir) => dir.path === parts.slice(0, index).join("/"));
      const entry = parent?.entries.find(
        (item) => item.path === parts.slice(0, index + 1).join("/"),
      );
      return (
        !parent?.error && entry?.kind === (index === parts.length - 1 ? bookmark.kind : "directory")
      );
    }) &&
    (bookmark.kind !== "directory" ||
      directories.some((dir) => dir.path === bookmark.path && !dir.error))
  );
}
