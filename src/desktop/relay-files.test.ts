import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { FileContext, FileSnapshot, RelayFileContext } from "../bridge/index.js";
import { RelayFiles } from "./relay-files.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
});
const context = (change: Partial<RelayFileContext> = {}): RelayFileContext => ({
  subscriptionId: randomUUID(),
  sequence: 1,
  active: true,
  directories: [""],
  preview: "note.txt",
  ...change,
});
function fixture() {
  vi.useFakeTimers();
  const read = vi.fn(
    async (context: FileContext, _current: () => boolean): Promise<FileSnapshot> => ({
      context,
      directories: [{ path: "", entries: [], error: null, truncated: false }],
      preview: {
        path: context.preview as string,
        text: context.root,
        size: 2,
        modifiedAt: null,
        error: null,
      },
    }),
  );
  const files = new RelayFiles(vi.fn(), read);
  files.visibility({ visible: true, worktrees: false });
  const set = (request: RelayFileContext, cwd = "/a", check = async () => {}, valid = () => {}) => {
    files.set(request, { cwd, check }, valid);
    disposers.push(() => files.remove(request.subscriptionId));
  };
  return { files, read, set };
}

it("shares identical canonical-root reads and keeps target caches/failures independent", async () => {
  const { files, read, set } = fixture();
  const a = context();
  const alias = context();
  const b = context();
  set(a);
  set(alias);
  set(b, "/b", async () => {
    throw new Error("B inaccessible");
  });
  await vi.waitFor(() => expect(files.snapshot(a.subscriptionId).files?.preview?.text).toBe("/a"));
  expect(files.snapshot(alias.subscriptionId).files?.preview?.text).toBe("/a");
  expect(read).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(files.snapshot(b.subscriptionId).filePolling?.failures).toBe(1));
  expect(files.snapshot(a.subscriptionId).filePolling?.failures).toBe(0);
  expect(files.snapshot(b.subscriptionId).filePolling?.lastError).toContain("B inaccessible");
});

it("rejects stale/reordered sequences and never publishes a superseded context", async () => {
  const { files, read, set } = fixture();
  let release = () => {};
  read.mockImplementationOnce(async (context) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { context, directories: [], preview: null };
  });
  const old = context();
  set(old);
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  const next = { ...old, sequence: 2, preview: "new.txt" };
  set(next);
  expect(() => set(old)).toThrow("newer context");
  expect(() => set({ ...next, preview: "conflict.txt" })).toThrow("newer context");
  set(next);
  expect(() => set({ ...next, sequence: 3 }, "/b")).toThrow("cannot change its root");
  release();
  await vi.waitFor(() => expect(files.snapshot(old.subscriptionId).files?.context).toEqual(next));
  expect(files.snapshot(old.subscriptionId).files?.preview?.path).toBe("new.txt");
});

it.each(["unsubscribe", "hidden", "paused", "inactive"] as const)(
  "discards in-flight previews after %s and does not schedule hidden work",
  async (operation) => {
    const { files, read, set } = fixture();
    let release = () => {};
    read.mockImplementationOnce(async (context) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { context, directories: [], preview: null };
    });
    const request = context();
    set(request);
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    if (operation === "unsubscribe") files.remove(request.subscriptionId);
    else if (operation === "hidden") files.visibility({ visible: false, worktrees: false });
    else if (operation === "paused") files.pause(true);
    else set({ ...request, sequence: 2, active: false });
    release();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(files.snapshot(request.subscriptionId).files).toBeNull();
    expect(read).toHaveBeenCalledOnce();
  },
);

it("rechecks root identity after reads and rejects stale subscription owners", async () => {
  const { files, read, set } = fixture();
  let checks = 0;
  const request = context();
  set(request, "/a", async () => {
    if (++checks > 1) throw new Error("Root identity changed");
  });
  await vi.waitFor(() =>
    expect(files.snapshot(request.subscriptionId).filePolling?.failures).toBe(1),
  );
  expect(read).toHaveBeenCalledOnce();
  expect(files.snapshot(request.subscriptionId).files).toBeNull();
  expect(files.snapshot(request.subscriptionId).filePolling?.lastError).toContain(
    "identity changed",
  );
  expect(() =>
    set(
      context(),
      "/b",
      async () => {},
      () => {
        throw new Error("closed owner");
      },
    ),
  ).toThrow("closed owner");
});

it("bounds contexts, applies saved settings, and releases closed roots", async () => {
  const { files, read, set } = fixture();
  files.configure({ files: { intervalMs: null, idleIntervalMs: null } });
  const ids = Array.from({ length: 16 }, () => context({ active: false }));
  for (const request of ids) set(request);
  expect(() => set(context())).toThrow("Too many");
  expect(read).not.toHaveBeenCalled();
  files.remove((ids[0] as RelayFileContext).subscriptionId);
  const visible = context();
  set(visible, "/b");
  await vi.waitFor(() => expect(files.snapshot(visible.subscriptionId).files).not.toBeNull());
  const before = read.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(before);
  expect(files.snapshot(visible.subscriptionId).filePolling?.status).toBe("disabled");
});
