import { expect, it, vi } from "vitest";
import type { MemoryDetail } from "../bridge/index.js";
import { RECALL_CACHE_LIMIT, RecallRecords } from "./memory-recall-model.js";

const detail = (id: string): MemoryDetail => ({
  record: { id, state: "active", text: "saved" } as MemoryDetail["record"],
  sources: [],
  revisions: [],
  incomplete: false,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("does no reads before activation, deduplicates IDs and drops unneeded cached data", async () => {
  const api = { memoryDetail: vi.fn(async ({ id }: { id: string }) => detail(id)) };
  const model = new RecallRecords(api);
  expect(api.memoryDetail).not.toHaveBeenCalled();
  await model.load(["a", "a", "b"]);
  expect(api.memoryDetail).toHaveBeenCalledTimes(2);
  expect([...model.snapshot().keys()]).toEqual(["a", "b"]);
  await model.load(["b", "c"]);
  expect([...model.snapshot().keys()]).toEqual(["b", "c"]);
  expect(api.memoryDetail).toHaveBeenCalledTimes(3);
  expect(model.snapshot().get("b")).toEqual({
    detail: { record: detail("b").record, incomplete: false },
  });
  model.stop();
  expect(model.snapshot().size).toBe(0);
});

it("bounds concurrent reads and the page cache at the worst-case full page", async () => {
  let running = 0;
  let peak = 0;
  const api = {
    memoryDetail: vi.fn(async ({ id }: { id: string }) => {
      running++;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running--;
      return detail(id);
    }),
  };
  const model = new RecallRecords(api);
  await model.load(Array.from({ length: 1000 }, (_, index) => `${index}`));
  expect(peak).toBe(4);
  expect(api.memoryDetail).toHaveBeenCalledTimes(RECALL_CACHE_LIMIT);
  expect(model.snapshot().size).toBe(RECALL_CACHE_LIMIT);
});

it("stops queued reads when hidden and rejects late records after owner disposal", async () => {
  const held = deferred<MemoryDetail>();
  const api = { memoryDetail: vi.fn(() => held.promise) };
  const old = new RecallRecords(api);
  const pending = old.load(["a", "b", "c", "d", "never-read"]);
  expect(api.memoryDetail).toHaveBeenCalledTimes(4);
  old.stop();
  held.resolve(detail("a"));
  await pending;
  expect(api.memoryDetail).toHaveBeenCalledTimes(4);
  expect(old.snapshot().size).toBe(0);
});

it("shares the concurrency bound across chat replacement and does not publish old results into the new owner", async () => {
  const requests: { id: string; held: ReturnType<typeof deferred<MemoryDetail>> }[] = [];
  const api = {
    memoryDetail: vi.fn(({ id }: { id: string }) => {
      const held = deferred<MemoryDetail>();
      requests.push({ id, held });
      return held.promise;
    }),
  };
  const old = new RecallRecords(api);
  const first = old.load(["a", "b", "c", "d", "old-queued"]);
  old.stop();
  const next = new RecallRecords(api);
  const second = next.load(["new"]);
  expect(requests).toHaveLength(4);
  for (const request of [...requests]) request.held.resolve(detail(request.id));
  await first;
  expect(requests.map((request) => request.id)).toEqual(["a", "b", "c", "d", "new"]);
  requests[4]?.held.resolve(detail("new"));
  await second;
  expect([...next.snapshot().keys()]).toEqual(["new"]);
  expect(old.snapshot().size).toBe(0);
});

it("refreshes edited records from notices or Retry and keeps unavailable placeholders", async () => {
  let version = 1;
  const api = {
    memoryDetail: vi.fn(async ({ id }: { id: string }) => {
      if (id === "missing") throw new Error("private error must not be displayed");
      return { ...detail(id), record: { ...detail(id).record, revision: version } };
    }),
  };
  const model = new RecallRecords(api);
  await model.load(["edited", "missing"]);
  expect(model.snapshot().get("missing")).toEqual({ unavailable: true });
  version++;
  await model.load(["edited", "missing"], true);
  expect(model.snapshot().get("edited")).toMatchObject({ detail: { record: { revision: 2 } } });
  expect(api.memoryDetail).toHaveBeenCalledTimes(4);
});

it("treats forgotten or mismatched detail replies as unavailable", async () => {
  const model = new RecallRecords({
    memoryDetail: async ({ id }) =>
      id === "forgotten"
        ? { ...detail(id), record: { ...detail(id).record, state: "forgotten" } }
        : detail("wrong-id"),
  });
  await model.load(["forgotten", "mismatch"]);
  expect([...model.snapshot().values()]).toEqual([{ unavailable: true }, { unavailable: true }]);
});

it("rejects reads invalidated by a refresh, even if their IDs are unchanged", async () => {
  const held = deferred<MemoryDetail>();
  const api = {
    memoryDetail: vi.fn().mockReturnValueOnce(held.promise).mockResolvedValue(detail("a")),
  };
  const model = new RecallRecords(api);
  const old = model.load(["a"]);
  await model.load(["a"], true);
  held.resolve({ ...detail("a"), record: { ...detail("a").record, text: "obsolete" } });
  await old;
  expect(model.snapshot().get("a")).toMatchObject({ detail: { record: { text: "saved" } } });
});

it("rejects the original A reply after navigation A → B → A with the same recalled ID", async () => {
  const original = deferred<MemoryDetail>();
  const api = {
    memoryDetail: vi.fn().mockReturnValueOnce(original.promise).mockResolvedValue(detail("a")),
  };
  const firstA = new RecallRecords(api);
  const first = firstA.load(["a"]);
  firstA.stop();
  const b = new RecallRecords(api);
  await b.load(["b"]);
  b.stop();
  const secondA = new RecallRecords(api);
  await secondA.load(["a"]);
  original.resolve({ ...detail("a"), record: { ...detail("a").record, text: "obsolete A" } });
  await first;
  expect(firstA.snapshot().size).toBe(0);
  expect(secondA.snapshot().get("a")).toMatchObject({ detail: { record: { text: "saved" } } });
});
