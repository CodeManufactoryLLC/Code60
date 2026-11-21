import { join, resolve, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { defaultDeps } from "./index.js";
import { createRecordStore, type RecordFs } from "./records.js";
import type { RunRecord } from "./types.js";

const root = resolve("record-store-fixture");
const alias = resolve("record-store-alias");
const missing = () => Object.assign(new Error("Missing fixture"), { code: "ENOENT" });
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const record = (id = "r1"): RunRecord => ({
  id,
  agent: "claude",
  status: "queued",
  firstPrompt: "fixture",
  turns: 0,
  base: null,
  branch: null,
  worktree: root,
  ownerPid: 1,
  startedAt: "2026-01-01T00:00:00Z",
});

function memoryFs() {
  const files = new Map<string, string>();
  const canonical = (path: string) => path.replace(alias, root);
  const fs = {
    recordStoreScope: {},
    realpath: vi.fn(async (path: string) => canonical(path)),
    mkdir: vi.fn(async () => {}),
    writeFile: vi.fn(async (path: string, data: string) => {
      const key = canonical(path);
      if (files.has(key)) throw Object.assign(new Error("Exists"), { code: "EEXIST" });
      files.set(key, data);
    }),
    appendFile: vi.fn(async (path: string, data: string) => {
      const key = canonical(path);
      files.set(key, (files.get(key) ?? "") + data);
    }),
    rename: vi.fn(async (from: string, to: string) => {
      const content = files.get(canonical(from));
      if (content === undefined) throw missing();
      files.set(canonical(to), content);
      files.delete(canonical(from));
    }),
    readFile: vi.fn(async (path: string) => {
      const content = files.get(canonical(path));
      if (content === undefined) throw missing();
      return content;
    }),
    readdir: vi.fn(async (path: string) => {
      const prefix = `${canonical(path)}${sep}`;
      return [
        ...new Set(
          [...files.keys()]
            .filter((key) => key.startsWith(prefix))
            .map((key) => key.slice(prefix.length).split(/[\\/]/)[0] as string),
        ),
      ];
    }),
    rm: vi.fn(async (path: string) => {
      files.delete(canonical(path));
    }),
  } satisfies RecordFs;
  return fs;
}

describe("shared record-store coordination", () => {
  it("saves nested project records within the Windows private-path limit", async () => {
    const fs = memoryFs();
    const directory = join(root, "project".padEnd(182 - root.length - 1, "x"));
    const id = "20261116-170358-b546d5";
    const write = fs.writeFile.getMockImplementation();
    if (!write) throw new Error("Missing fixture writer");
    fs.writeFile.mockImplementation(async (path, data) => {
      if (path.length > 247) throw new Error("Unsupported Windows path");
      await write(path, data);
    });
    const store = createRecordStore(fs, directory);
    expect(join(directory, id, "run.json")).toHaveLength(214);
    await store.save(record(id));
    await store.save({ ...record(id), status: "running" });
    expect((await store.read(id)).status).toBe("running");
    expect(await fs.readdir(join(directory, id))).toEqual(["run.json"]);
    const temporaryPaths = fs.writeFile.mock.calls.map(([path]) => path);
    expect(new Set(temporaryPaths).size).toBe(2);
    for (const path of temporaryPaths) expect(path.length).toBeLessThanOrEqual(247);
  });

  it("shares native storage scope across independently created dependencies", () => {
    expect(defaultDeps().fs.recordStoreScope).toBe(defaultDeps().fs.recordStoreScope);
  });

  it("serializes aliased same-run writes across wrappers without blocking another run", async () => {
    const fs = memoryFs();
    const write = fs.writeFile.getMockImplementation();
    if (!write) throw new Error("Missing fixture writer");
    const entered = deferred();
    const release = deferred();
    fs.writeFile.mockImplementationOnce(async (path, data) => {
      entered.resolve();
      await release.promise;
      await write(path, data);
    });
    const a = createRecordStore(fs, root);
    const b = createRecordStore({ ...fs }, alias);
    const first = a.save(record());
    await entered.promise;
    const second = b.save({ ...record(), status: "running" });
    try {
      await b.appendEvent({ runId: "other", at: "t", type: "message", text: "independent" });
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
      await Promise.allSettled([first, second]);
    }
    await Promise.all([first, second]);
    expect((await a.read("r1")).status).toBe("running");
    expect(await b.readEvents("other")).toHaveLength(1);
    expect(await fs.readdir(join(root, "r1"))).toEqual(["run.json"]);
  });

  it("deduplicates only in-flight aliased listings and isolates returned records", async () => {
    const fs = memoryFs();
    const a = createRecordStore(fs, root);
    const b = createRecordStore({ ...fs }, alias);
    await a.save(record());
    const read = fs.readdir.getMockImplementation();
    if (!read) throw new Error("Missing fixture reader");
    const release = deferred();
    fs.readdir.mockImplementationOnce(async (path) => {
      await release.promise;
      return read(path);
    });
    const first = a.list();
    const second = b.list();
    await vi.waitFor(() => expect(fs.readdir).toHaveBeenCalledTimes(1));
    release.resolve();
    const [left, right] = await Promise.all([first, second]);
    expect(fs.readdir).toHaveBeenCalledTimes(1);
    expect(fs.readFile).toHaveBeenCalledTimes(1);
    expect(left).toEqual(right);
    if (left[0]) left[0].status = "failed";
    expect(right[0]?.status).toBe("queued");
    await b.save({ ...record(), status: "running" });
    expect((await a.list())[0]?.status).toBe("running");
    expect(fs.readdir).toHaveBeenCalledTimes(2);
  });

  it("does not coalesce strict indexing with tolerant history listings", async () => {
    const fs = memoryFs();
    const store = createRecordStore(fs, root);
    await store.save(record());
    fs.readFile.mockRejectedValue(new Error("Corrupt record"));
    const [normal, strict] = await Promise.allSettled([store.list(), store.list(true)]);
    expect(normal).toEqual({ status: "fulfilled", value: [] });
    expect(strict.status).toBe("rejected");
  });

  it.each(["readFile", "readdir"] as const)(
    "does not bypass a different injected %s policy through listing deduplication",
    async (method) => {
      const fs = memoryFs();
      const a = createRecordStore(fs, root);
      await a.save(record());
      const read = fs.readdir.getMockImplementation();
      if (!read) throw new Error("Missing fixture reader");
      const entered = deferred();
      const release = deferred();
      fs.readdir.mockImplementationOnce(async (path) => {
        entered.resolve();
        await release.promise;
        return read(path);
      });
      const b = createRecordStore(
        {
          ...fs,
          ...(method === "readFile"
            ? {
                readFile: async () => {
                  throw new Error("Restricted read");
                },
              }
            : { readdir: async () => [] }),
        },
        alias,
      );
      const first = a.list();
      await entered.promise;
      const second = b.list();
      try {
        await b.appendEvent({ runId: "other", at: "t", type: "message", text: "independent" });
      } finally {
        release.resolve();
      }
      const [unrestricted, restricted] = await Promise.all([first, second]);
      expect(unrestricted).toHaveLength(1);
      expect(restricted).toEqual([]);
    },
  );

  it("keeps unrelated injected filesystems separate even at an identical path", async () => {
    const a = createRecordStore(memoryFs(), root);
    const b = createRecordStore(memoryFs(), root);
    await Promise.all([a.save(record("first")), b.save(record("second"))]);
    const [left, right] = await Promise.all([a.list(), b.list()]);
    expect(left.map((item) => item.id)).toEqual(["first"]);
    expect(right.map((item) => item.id)).toEqual(["second"]);
  });

  it("canonicalizes the existing ancestor before a new record directory exists", async () => {
    const fs = memoryFs();
    fs.realpath.mockImplementation(async (path) => {
      if (path === join(root, "code60", "runs") || path === join(root, "code60")) throw missing();
      return path;
    });
    const store = createRecordStore(fs, join(root, "code60", "runs"));
    await store.save(record());
    expect(fs.realpath.mock.calls.map(([path]) => path)).toEqual([
      join(root, "code60", "runs"),
      join(root, "code60"),
      root,
    ]);
    expect((await store.list())[0]?.id).toBe("r1");
  });

  it("coalesces queued event appends without moving them across run.json saves", async () => {
    const fs = memoryFs();
    const store = createRecordStore(fs, root);
    const other = createRecordStore({ ...fs }, alias);
    await other.list();
    const append = fs.appendFile.getMockImplementation();
    if (!append) throw new Error("Missing fixture appender");
    const entered = deferred();
    const release = deferred();
    fs.appendFile.mockImplementationOnce(async (path, data) => {
      entered.resolve();
      await release.promise;
      await append(path, data);
    });
    const event = (text: string) =>
      store.appendEvent({ runId: "r1", at: "t", type: "message", text });
    const first = event("0");
    await entered.promise;
    const queued = [event("1"), event("2")];
    const saved = other.save(record());
    const later = [event("3"), event("4")];
    release.resolve();
    await Promise.all([first, ...queued, saved, ...later]);
    expect(fs.appendFile.mock.calls.map(([, data]) => data.split("\n").length - 1)).toEqual([
      1, 2, 2,
    ]);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const appends = fs.appendFile.mock.invocationCallOrder;
    const save = fs.writeFile.mock.invocationCallOrder[0] as number;
    expect(appends[1]).toBeLessThan(save);
    expect(appends[2]).toBeGreaterThan(save);
    expect(
      (await store.readEvents("r1")).map((entry) => (entry.type === "message" ? entry.text : "")),
    ).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("splits queued append batches at the character bound without losing events", async () => {
    const fs = memoryFs();
    const store = createRecordStore(fs, root);
    const entered = deferred();
    const release = deferred();
    const append = fs.appendFile.getMockImplementation();
    if (!append) throw new Error("Missing fixture appender");
    fs.appendFile.mockImplementationOnce(async (path, data) => {
      entered.resolve();
      await release.promise;
      await append(path, data);
    });
    const event = (text: string) =>
      store.appendEvent({ runId: "r1", at: "t", type: "message", text });
    const first = event("held");
    await entered.promise;
    const overhead = JSON.stringify({ runId: "r1", at: "t", type: "message", text: "" }).length + 1;
    const text = "x".repeat(524_288 - overhead);
    const queued = [event(text), event(text), event("last")];
    release.resolve();
    await Promise.all([first, ...queued]);
    expect(fs.appendFile).toHaveBeenCalledTimes(3);
    for (const [, data] of fs.appendFile.mock.calls)
      expect(data.length).toBeLessThanOrEqual(1_048_576);
    expect(
      (await store.readEvents("r1")).map((entry) => (entry.type === "message" ? entry.text : "")),
    ).toEqual(["held", text, text, "last"]);
  });

  it("rejects every event in a failed coalesced append and accepts later events", async () => {
    const fs = memoryFs();
    const store = createRecordStore(fs, root);
    const entered = deferred();
    const release = deferred();
    fs.appendFile.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
    });
    fs.appendFile.mockRejectedValueOnce(new Error("Append failed"));
    const event = (text: string) =>
      store.appendEvent({ runId: "r1", at: "t", type: "message", text });
    const first = event("held");
    await entered.promise;
    const failed = [event("a"), event("b")].map((promise) =>
      expect(promise).rejects.toThrow("Append failed"),
    );
    release.resolve();
    await first;
    await Promise.all(failed);
    await event("after");
    expect(fs.appendFile).toHaveBeenCalledTimes(3);
    expect(
      (await store.readEvents("r1")).map((entry) => (entry.type === "message" ? entry.text : "")),
    ).toEqual(["after"]);
  });

  it("releases failed writes and listings and retries failed canonicalization", async () => {
    const fs = memoryFs();
    const store = createRecordStore(fs, root);
    fs.realpath.mockRejectedValueOnce(new Error("Unavailable"));
    await expect(store.save(record())).rejects.toThrow("Unavailable");
    fs.writeFile.mockRejectedValueOnce(new Error("Write failed"));
    await expect(store.save(record())).rejects.toThrow("Write failed");
    await store.save(record());
    fs.readdir.mockRejectedValueOnce(new Error("Read failed"));
    await expect(store.list()).rejects.toThrow("Read failed");
    expect(await store.list()).toHaveLength(1);
    expect(await fs.readdir(join(root, "r1"))).toEqual(["run.json"]);
  });
});
