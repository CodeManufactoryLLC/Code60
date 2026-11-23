import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { planCreateSchema, planSchema, planUpdateSchema } from "../bridge/index.js";
import { PlanStore } from "./plans.js";

const roots: string[] = [];
const stores: PlanStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.stopTiming();
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const draft = {
  requestId: "timing",
  title: "Timed plan",
  description: "",
  tasks: [{ text: "Build" }, { text: "Verify" }],
};
async function fixture(strict = false, onTimingError?: () => void) {
  const root = await mkdtemp(join(tmpdir(), "code60-plan-timing-"));
  roots.push(root);
  let now = 1_000;
  const open = async () => {
    const store = await PlanStore.open(root, "chat", strict, { now: () => now, onTimingError });
    stores.push(store);
    return store;
  };
  const store = await open();
  const plan = await store.create(draft, null);
  const path = join(root, ".code60", "plans", `${plan.id}.json`);
  const markdown = join(root, "plans", `${plan.id}.md`);
  const change = (state: typeof plan.state) =>
    store.mutate(plan.id, (plan) => {
      plan.state = state;
    });
  return {
    root,
    store,
    plan,
    path,
    markdown,
    open,
    change,
    time: (value: number) => {
      now = value;
    },
  };
}

it.each([false, true])(
  "accumulates running segments without revision/Markdown changes on checkpoints (strict %s)",
  async (strict) => {
    const { store, plan, path, markdown, change, time } = await fixture(strict);
    expect(plan.executionTiming).toEqual({ elapsedMs: 0 });
    time(10_000);
    await store.action({
      type: "accept",
      chatId: "chat",
      planId: plan.id,
      revision: plan.revision,
    });
    time(20_000);
    const running = await change("running");
    const text = await readFile(markdown, "utf8");
    time(25_000);
    await store.checkpointTiming();
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.executionTiming).toEqual({ elapsedMs: 5_000, runningSince: 25_000 });
    expect(saved.revision).toBe(running.revision);
    expect(saved.acceptedRevision).toBe(plan.revision);
    expect(await readFile(markdown, "utf8")).toBe(text);
    // Concurrent worker/progress writes count one shared plan interval, not one per worker.
    time(27_000);
    await Promise.all(
      ["a", "b"].map((id) =>
        store.mutate(plan.id, (plan) => {
          plan.tasks[0]?.workerIds.push(id);
        }),
      ),
    );
    expect(store.get(plan.id).executionTiming?.elapsedMs).toBe(7_000);
    time(30_000);
    const paused = await change("paused");
    expect(paused.executionTiming).toEqual({ elapsedMs: 10_000 });
    time(100_000);
    const queued = await store.action({
      type: "resume",
      chatId: "chat",
      planId: plan.id,
      revision: paused.revision,
    });
    expect(queued.executionTiming).toEqual({ elapsedMs: 10_000 });
    time(110_000);
    await change("running");
    time(112_000);
    const failed = await change("failed");
    expect(failed.executionTiming).toEqual({ elapsedMs: 12_000 });
    time(120_000);
    await change("queued");
    await change("running");
    time(123_000);
    expect((await change("completed")).executionTiming).toEqual({ elapsedMs: 15_000 });
    time(999_000);
    await store.checkpointTiming();
    expect(store.get(plan.id).executionTiming).toEqual({ elapsedMs: 15_000 });
  },
);

it("recovers only recorded running time and excludes downtime without restoring authority", async () => {
  const { store, plan, change, time, open } = await fixture();
  await change("running");
  time(6_000);
  await store.checkpointTiming();
  store.stopTiming(); // Simulated process loss, before another interval is saved.
  time(1_000_000);
  const reopened = await open();
  expect(reopened.get(plan.id)).toMatchObject({
    state: "paused",
    executionTiming: { elapsedMs: 5_000 },
  });
  expect(reopened.get(plan.id).executionTiming).not.toHaveProperty("runningSince");
  expect(reopened.get(plan.id).error).toContain("interrupted");
});

it.each(["paused", "completed"] as const)(
  "loads legacy %s plans without fabricating history",
  async (state) => {
    const { store, plan, path, open, time } = await fixture();
    const legacy = { ...plan, state };
    delete legacy.executionTiming;
    await writeFile(path, JSON.stringify(legacy));
    store.stopTiming();
    const reopened = await open();
    expect(reopened.get(plan.id).executionTiming).toBeUndefined();
    if (state === "paused") {
      await reopened.mutate(plan.id, (plan) => {
        plan.state = "running";
      });
      time(4_000);
      const paused = await reopened.mutate(plan.id, (plan) => {
        plan.state = "paused";
      });
      expect(paused.executionTiming).toEqual({ elapsedMs: 3_000, historyIncomplete: true });
    }
  },
);

it("starts a legacy never-executed draft at zero and clamps a backwards clock", async () => {
  const { store, plan, path, open, time } = await fixture();
  const legacy = { ...plan };
  delete legacy.executionTiming;
  await writeFile(path, JSON.stringify(legacy));
  store.stopTiming();
  const reopened = await open();
  await reopened.action({
    type: "accept",
    chatId: "chat",
    planId: plan.id,
    revision: plan.revision,
  });
  await reopened.mutate(plan.id, (plan) => {
    plan.state = "running";
  });
  time(500);
  expect(
    (
      await reopened.mutate(plan.id, (plan) => {
        plan.state = "paused";
      })
    ).executionTiming,
  ).toEqual({ elapsedMs: 0 });
});

it("restores checkpoint totals on Undo and freezes discarded plans", async () => {
  const { store, plan, change, time } = await fixture();
  await change("running");
  time(6_000);
  await store.checkpointTiming();
  const checkpoint = store.get(plan.id);
  time(20_000);
  await change("paused");
  await store.rewind([checkpoint]);
  expect(store.get(plan.id).executionTiming).toEqual({ elapsedMs: 5_000 });
  expect(store.get(plan.id).state).toBe("paused");
  time(30_000);
  await change("running");
  time(34_000);
  await store.rewind([]);
  expect(store.get(plan.id)).toMatchObject({
    rewound: true,
    state: "dismissed",
    executionTiming: { elapsedMs: 9_000 },
  });
  time(50_000);
  await store.checkpointTiming();
  expect(store.get(plan.id).executionTiming).toEqual({ elapsedMs: 9_000 });
});

it("preserves state and private/Markdown data when a timing checkpoint fails", async () => {
  const { root, store, plan, path, markdown, change, time } = await fixture(true);
  await change("running");
  const before = store.get(plan.id);
  const original = await readFile(path, "utf8");
  const text = await readFile(markdown, "utf8");
  const outside = join(root, "outside.json");
  await writeFile(outside, "private evidence");
  await rm(path);
  await symlink(outside, path);
  time(6_000);
  await expect(store.checkpointTiming()).rejects.toThrow();
  expect(store.get(plan.id)).toEqual(before);
  expect(await readFile(outside, "utf8")).toBe("private evidence");
  expect(await readFile(markdown, "utf8")).toBe(text);
  await rm(path);
  await writeFile(path, original, { mode: 0o600 });
  await store.checkpointTiming();
  expect(store.get(plan.id).executionTiming?.elapsedMs).toBe(5_000);
});

it("schedules five-second checkpoints, reports failures once and cancels owner timers", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const warning = vi.fn();
  const { store, change, time } = await fixture(false, warning);
  const checkpoint = vi
    .spyOn(store, "checkpointTiming")
    .mockRejectedValue(new Error("disk unavailable"));
  await change("running");
  time(6_000);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(checkpoint).toHaveBeenCalledTimes(1);
  expect(warning).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(checkpoint).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledTimes(1);
  checkpoint.mockResolvedValue(undefined);
  await vi.advanceTimersByTimeAsync(5_000);
  checkpoint.mockRejectedValue(new Error("disk unavailable"));
  await vi.advanceTimersByTimeAsync(5_000);
  expect(warning).toHaveBeenCalledTimes(2);
  store.stopTiming();
  await vi.advanceTimersByTimeAsync(20_000);
  expect(checkpoint).toHaveBeenCalledTimes(4);
});

it("validates optional timing metadata without accepting agent-supplied timing", async () => {
  const { plan } = await fixture();
  expect(planSchema.safeParse(plan).success).toBe(true);
  for (const elapsedMs of [-1, Infinity, 1.5])
    expect(planSchema.safeParse({ ...plan, executionTiming: { elapsedMs } }).success).toBe(false);
  expect(planCreateSchema.safeParse({ ...draft, executionTiming: { elapsedMs: 10 } }).success).toBe(
    false,
  );
  expect(
    planUpdateSchema.safeParse({
      operation: "revise",
      planId: plan.id,
      revision: 1,
      draft,
      executionTiming: { elapsedMs: 10 },
    }).success,
  ).toBe(false);
});
