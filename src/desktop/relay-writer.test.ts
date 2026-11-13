import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { logInputSchema } from "../bridge/index.js";
import type { RelayMessage } from "./relay-history.js";
import { RelayPersistenceError } from "./relay-persistence.js";
import type { RelayAppend } from "./relay-store.js";
import { RelayWriter } from "./relay-writer.js";

afterEach(() => vi.useRealTimers());
const message = (text: string): RelayMessage => ({
  id: randomUUID(),
  role: "assistant",
  at: new Date().toISOString(),
  text,
});
function fixture() {
  const saved: RelayAppend[] = [];
  const store = {
    appendBatch: vi.fn(async (batch: readonly RelayAppend[]) => {
      saved.push(...batch);
    }),
    markIncomplete: vi.fn(async () => {}),
  };
  const log = vi.fn();
  const changed = vi.fn();
  return { store, saved, log, changed, writer: new RelayWriter(store, log, changed) };
}

it("coalesces thousands of tiny chunks and flushes within 50 ms with exact Unicode", async () => {
  vi.useFakeTimers();
  const { writer, saved, store } = fixture();
  const source = message("");
  for (let i = 0; i < 3000; i++) writer.enqueue({ ...source, text: "😀文" }, i === 0);
  await vi.advanceTimersByTimeAsync(49);
  expect(store.appendBatch).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(saved).toEqual([{ message: { ...source, text: "😀文".repeat(3000) }, start: true }]);
  expect(store.appendBatch).toHaveBeenCalledTimes(1);
  expect(writer.failed).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("flushes at 64 KiB and serializes chunks arriving during a slow write", async () => {
  const { writer, saved, store } = fixture();
  let release!: () => void;
  store.appendBatch.mockImplementationOnce(async (batch) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    saved.push(...batch);
  });
  const source = message("a".repeat(65536));
  writer.enqueue(source, true);
  expect(store.appendBatch).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 3000; i++) writer.enqueue({ ...source, text: "b" }, false);
  expect(store.appendBatch).toHaveBeenCalledTimes(1);
  release();
  await writer.flush();
  expect(store.appendBatch).toHaveBeenCalledTimes(2);
  expect(saved.map((item) => item.message.text).join("")).toBe(source.text + "b".repeat(3000));
  expect(saved.map((item) => item.start)).toEqual([true, false]);
});

it("includes in-flight data in the capacity limit and discards queued data on overflow", async () => {
  const { writer, saved, store, log } = fixture();
  let release!: () => void;
  store.appendBatch.mockImplementationOnce(async (batch) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    saved.push(...batch);
  });
  writer.enqueue(message("a".repeat(1_048_576)), true);
  writer.enqueue(message("b"), true);
  expect(writer.failed).toBe(true);
  expect(log.mock.calls[0]?.[0]).toMatchObject({
    persistenceStage: "queue",
    persistenceFailure: "capacity",
    queuedCharacters: 1_048_576,
  });
  release();
  await writer.flush();
  expect(saved).toHaveLength(1);
  expect(store.markIncomplete).toHaveBeenCalledTimes(1);
  writer.enqueue(message("discard"), true);
  await writer.flush();
  expect(store.appendBatch).toHaveBeenCalledTimes(1);
});

it("bounds metadata for distinct empty messages", async () => {
  const { writer, store } = fixture();
  for (let i = 0; i < 1025; i++) writer.enqueue(message(""), true);
  await writer.flush();
  expect(writer.failed).toBe(true);
  expect(store.appendBatch).not.toHaveBeenCalled();
  expect(store.markIncomplete).toHaveBeenCalledTimes(1);
});

it("keeps the first write failure and reports marker failure without source or raw exceptions", async () => {
  const { writer, store, log, changed } = fixture();
  store.appendBatch.mockRejectedValueOnce(
    new RelayPersistenceError(
      "sync",
      "io",
      Object.assign(new Error("secret prompt /private/path"), { code: "ENOSPC" }),
    ),
  );
  store.markIncomplete.mockRejectedValueOnce(new Error("secret marker failure"));
  writer.enqueue(message("secret message"), true);
  await writer.flush();
  writer.enqueue(message("later"), true);
  await writer.flush();
  expect(store.appendBatch).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledTimes(1);
  const records = log.mock.calls.map(([record]) => logInputSchema.parse(record));
  expect(records.map((record) => record.persistenceStage)).toEqual(["sync", "mark-incomplete"]);
  expect(records[0]?.errorCode).toBe("ENOSPC");
  expect(JSON.stringify(records)).not.toMatch(/secret|private/);
});

it("flushes message boundaries in order and leaves no timer after shutdown flush", async () => {
  vi.useFakeTimers();
  const { writer, saved, store } = fixture();
  const a = message("first");
  const b = { ...message("second"), role: "human" as const };
  writer.enqueue(a, true);
  writer.enqueue(b, true);
  await writer.flush();
  expect(saved).toEqual([
    { message: a, start: true },
    { message: b, start: true },
  ]);
  expect(store.appendBatch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
