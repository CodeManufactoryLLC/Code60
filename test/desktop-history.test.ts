import { expect, it, vi } from "vitest";
import { withDirectoryHistory } from "../src/core/desktop-history.js";
import type { RunRecord } from "../src/core/index.js";
import { MemoryStore } from "./fakes.js";

it("reads a complete history snapshot with one metadata listing per store", async () => {
  const primary = new MemoryStore(),
    legacy = new MemoryStore();
  for (let i = 0; i < 2000; i++) {
    const store = i % 2 ? primary : legacy;
    await store.save({ id: String(i), startedAt: String(i) } as RunRecord);
    await store.appendEvent({ type: "message", runId: String(i), at: "now", text: `reply ${i}` });
  }
  const current = vi.spyOn(primary, "list"),
    previous = vi.spyOn(legacy, "list");
  const combined = withDirectoryHistory(primary, legacy);
  const records = await combined.list(true);
  for (const record of records)
    expect((await combined.readEvents(record.id))[0]?.runId).toBe(record.id);
  expect(current).toHaveBeenCalledTimes(1);
  expect(previous).toHaveBeenCalledTimes(1);
  await primary.save({ id: "legacy-new", startedAt: "now" } as RunRecord);
  expect(await combined.readEvents("legacy-new")).toEqual([]);
  await legacy.save({ id: "legacy-new", startedAt: "now" } as RunRecord);
  await expect(combined.list()).rejects.toThrow("Conflicting");
});
