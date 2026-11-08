import { execFileSync } from "node:child_process";
import { appendFile, mkdtemp, open, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReviewStore } from "./reviews.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, open: vi.fn(fs.open) };
});

let root: string;
let store: ReviewStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "code60-review-reads-"));
  store = await ReviewStore.open(root, "/project");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

it("reads the validated handle when its pathname is replaced", async () => {
  const review = await store.create("chat", 1, "Original review");
  const path = join(store.root, `${review.id}.json`);
  const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  let closed = false;
  vi.mocked(open).mockImplementationOnce(async (...args) => {
    const file = await fs.open(...args);
    const stat = file.stat.bind(file);
    const close = file.close.bind(file);
    vi.spyOn(file, "stat").mockImplementationOnce(async () => {
      const info = await stat({ bigint: true });
      await rename(path, `${path}.original`);
      await writeFile(path, JSON.stringify({ ...review, title: "Replacement review" }));
      return info;
    });
    vi.spyOn(file, "close").mockImplementation(async () => {
      await close();
      closed = true;
    });
    return file;
  });
  const restored = ReviewStore.open(root, "/project");
  if (process.platform === "win32") await expect(restored).rejects.toThrow("changed");
  else expect((await restored).get(review.id).title).toBe("Original review");
  expect(closed).toBe(true);
});

it("bounds the actual read if a record grows after handle validation", async () => {
  const review = await store.create("chat", 1, "Growing review");
  const path = join(store.root, `${review.id}.json`);
  const fs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  let closed = false;
  vi.mocked(open).mockImplementationOnce(async (...args) => {
    const file = await fs.open(...args);
    const stat = file.stat.bind(file);
    const close = file.close.bind(file);
    vi.spyOn(file, "stat").mockImplementationOnce(async () => {
      const info = await stat({ bigint: true });
      await appendFile(path, Buffer.alloc(16 * 1_048_576, 32));
      return info;
    });
    vi.spyOn(file, "close").mockImplementation(async () => {
      await close();
      closed = true;
    });
    return file;
  });
  await expect(ReviewStore.open(root, "/project")).rejects.toThrow("too large");
  expect(closed).toBe(true);
});

it.skipIf(process.platform === "win32")(
  "rejects symlinks and FIFOs without reading or blocking",
  async () => {
    const review = await store.create("chat", 1, "Linked review");
    const path = join(store.root, `${review.id}.json`);
    const original = `${path}.original`;
    await rename(path, original);
    await symlink(original, path);
    await expect(ReviewStore.open(root, "/project")).rejects.toThrow();
    await rm(path);
    execFileSync("mkfifo", [path]);
    await expect(ReviewStore.open(root, "/project")).rejects.toThrow("unavailable");
  },
);
