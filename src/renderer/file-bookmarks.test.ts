import { describe, expect, it } from "vitest";
import type { FileDirectory } from "../bridge/index.js";
import {
  bookmarkAvailable,
  bookmarkDirectories,
  bookmarkKey,
  readBookmarks,
  writeBookmarks,
} from "./file-bookmarks.js";

function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
}
const file = { path: "src/main.ts", kind: "file" as const };
const folder = { path: "src", kind: "directory" as const };
const directories = [
  { path: "", entries: [{ ...folder, name: "src" }], error: null, truncated: false },
  { path: "src", entries: [{ ...file, name: "main.ts" }], error: null, truncated: false },
] as const satisfies FileDirectory[];
describe("project bookmarks", () => {
  it("persists independently per canonical project and supports removal", () => {
    const disk = storage();
    writeBookmarks(disk, "/a", [file, folder]);
    writeBookmarks(disk, "/b", [folder]);
    expect(readBookmarks(disk, "/a")).toEqual([file, folder]);
    expect(readBookmarks(disk, "/b")).toEqual([folder]);
    writeBookmarks(disk, "/a", [file]);
    expect(readBookmarks(disk, "/a")).toEqual([file]);
    expect(readBookmarks(disk, "/b")).toEqual([folder]);
  });
  it.each(["../outside", "/absolute", "a/../b", "C:/file", "a\\b", "a//b", "", "a/./b"])(
    "rejects unsafe saved path %s",
    (path) => {
      const disk = storage();
      disk.setItem(bookmarkKey("/a"), JSON.stringify([{ path, kind: "file" }]));
      expect(() => readBookmarks(disk, "/a")).toThrow();
      expect(() => writeBookmarks(disk, "/a", [{ path, kind: "file" }])).toThrow();
    },
  );
  it("bounds corrupt and oversized storage without overwriting it", () => {
    const disk = storage();
    disk.setItem(bookmarkKey("/a"), "invalid");
    expect(() => readBookmarks(disk, "/a")).toThrow();
    expect(disk.getItem(bookmarkKey("/a"))).toBe("invalid");
    expect(() => writeBookmarks(disk, "/a", Array(101).fill(file))).toThrow();
    disk.setItem(bookmarkKey("/a"), JSON.stringify([file, file]));
    expect(() => readBookmarks(disk, "/a")).toThrow();
  });
  it("propagates unavailable storage instead of claiming persistence", () => {
    expect(() =>
      writeBookmarks(
        {
          setItem() {
            throw new Error("quota");
          },
        },
        "/a",
        [file],
      ),
    ).toThrow("quota");
  });
  it("expands only required ancestors and checks every target kind", () => {
    expect(bookmarkDirectories(file)).toEqual(["src"]);
    expect(bookmarkDirectories(folder)).toEqual(["src"]);
    expect(bookmarkAvailable(file, directories)).toBe(true);
    expect(bookmarkAvailable(folder, directories)).toBe(true);
    expect(bookmarkAvailable(file, directories.slice(0, 1))).toBe(false);
    expect(bookmarkAvailable(file, [directories[0], { ...directories[1], entries: [] }])).toBe(
      false,
    );
    expect(
      bookmarkAvailable(file, [
        { ...directories[0], entries: [{ ...folder, name: "src", kind: "symlink" }] },
        directories[1],
      ]),
    ).toBe(false);
    expect(
      bookmarkAvailable(folder, [directories[0], { ...directories[1], error: "Unavailable" }]),
    ).toBe(false);
  });
});
