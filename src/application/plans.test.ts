import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { parsePlanAction, planCreateSchema, planUpdateSchema } from "../bridge/index.js";
import { PlanStore } from "./plans.js";

const roots: string[] = [];
const stores: PlanStore[] = [];
async function openPlanStore(...args: Parameters<typeof PlanStore.open>) {
  const store = await PlanStore.open(...args);
  stores.push(store);
  return store;
}
afterEach(async () => {
  for (const store of stores.splice(0)) store.stopTiming();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const parent = await mkdtemp(join(tmpdir(), "code60-plan-"));
  roots.push(parent);
  const root = join(parent, "chat");
  return { root, store: await openPlanStore(root, "chat") };
}
const draft = {
  requestId: "first",
  title: "Build",
  description: "A small change",
  tasks: [{ text: "Implement" }, { text: "Verify" }],
};
it("rewinds plan context without decreasing revisions or reviving discarded authority", async () => {
  const { root, store } = await setup();
  const original = await store.create(draft, "/project");
  await store.mutate(original.id, (plan) => {
    plan.title = "Later plan change";
  });
  await store.mutate(original.id, (plan) => {
    plan.tasks[0]?.workerIds.push("worker");
  });
  const currentRevision = store.get(original.id).revision;
  await store.rewind([original]);
  expect(store.get(original.id)).toMatchObject({
    title: "Build",
    revision: currentRevision + 1,
  });
  expect(store.get(original.id).tasks.every((task) => task.workerIds.length === 0)).toBe(true);
  await store.rewind([]);
  expect(store.list()).toEqual([]);
  expect(store.get(original.id).rewound).toBe(true);
  await expect(
    store.mutate(original.id, (plan) => {
      plan.title = "Late update";
    }),
  ).rejects.toThrow("discarded by Undo");
  const reopened = await openPlanStore(root, "chat");
  expect(reopened.list()).toEqual([]);
  expect(reopened.get(original.id).title).toBe("Build");
});
it("keeps Relay target assignments and rejects private-record changes instead of overwriting them", async () => {
  const parent = await mkdtemp(join(tmpdir(), "code60-private-plan-"));
  roots.push(parent);
  const root = join(parent, "documents");
  const store = await openPlanStore(root, "relay", true);
  const target = { id: randomUUID(), cwd: "/absolute/target", workspaceMode: "direct" as const };
  const request = {
    ...draft,
    tasks: [
      { text: "Direct task", target: { cwd: target.cwd, workspaceMode: target.workspaceMode } },
    ],
  };
  const plan = await store.create(request, null, [target]);
  expect(plan.tasks[0]?.target).toEqual(target);
  const path = join(root, ".code60", "plans", `${plan.id}.json`);
  const data = await readFile(path, "utf8");
  await writeFile(path, data.replace('"Build"', '"Changed outside Code60"'));
  await expect(
    store.action({ type: "accept", chatId: "relay", planId: plan.id, revision: plan.revision }),
  ).rejects.toThrow("metadata changed");
  expect(store.get(plan.id).state).toBe("draft");
  expect(await readFile(path, "utf8")).toContain("Changed outside Code60");
  await writeFile(path, data);
  expect((await openPlanStore(root, "relay", true)).get(plan.id).tasks[0]?.target).toEqual(target);
  await chmod(path, 0o644);
  await expect(PlanStore.open(root, "relay", true)).rejects.toThrow("permissions");
});
it("creates one draft, preserves task identities on revision and deduplicates creation", async () => {
  const { root, store } = await setup();
  const plan = await store.create(draft, "/project");
  expect(await store.create(draft, "/project")).toEqual(plan);
  await expect(store.create({ ...draft, title: "Other" }, "/project")).rejects.toThrow("requestId");
  await expect(store.create({ ...draft, requestId: "second" }, "/project")).rejects.toThrow(
    "unfinished",
  );
  const revised = await store.update({
    operation: "revise",
    planId: plan.id,
    revision: 1,
    draft: {
      title: "Revised",
      description: "",
      tasks: [{ id: plan.tasks[0]?.id, text: "Implement better" }],
    },
  });
  expect(revised.tasks[0]?.id).toBe(plan.tasks[0]?.id);
  expect(store.list()[0]).toMatchObject({ total: 1, completed: 0, proposalRevision: 2 });
  await expect(
    store.action({ type: "accept", chatId: "chat", planId: plan.id, revision: 1 }),
  ).rejects.toThrow("changed");
  expect(await readFile(join(root, "plans", `${plan.id}.md`), "utf8")).toContain(
    "- [ ] Implement better",
  );
});
it("accepts once, freezes definitions, and only checks verified completed tasks", async () => {
  const { root, store } = await setup();
  const plan = await store.create(draft, null);
  const update = {
    operation: "progress" as const,
    planId: plan.id,
    taskId: plan.tasks[0]?.id as string,
    revision: 1,
    state: "completed" as const,
    note: "Tests passed",
  };
  await expect(store.update(update)).rejects.toThrow("Accept");
  const action = { type: "accept" as const, chatId: "chat", planId: plan.id, revision: 1 };
  const [a, b] = await Promise.all([store.action(action), store.action(action)]);
  expect(a).toEqual(b);
  let current = await store.mutate(plan.id, (item) => {
    item.state = "running";
  });
  await expect(
    store.update({ operation: "revise", planId: plan.id, revision: current.revision, draft }),
  ).rejects.toThrow("Only draft");
  current = await store.update({ ...update, revision: current.revision });
  expect(store.list()[0]).toMatchObject({ total: 2, completed: 1, state: "running" });
  const markdown = await readFile(join(root, "plans", `${plan.id}.md`), "utf8");
  expect(markdown).toContain("- [x] Implement");
  expect(markdown).toContain("- [ ] Verify");
  expect(markdown).not.toContain("out of");
  current = await store.update({
    ...update,
    taskId: current.tasks[1]?.id as string,
    revision: current.revision,
    state: "blocked",
    note: "Missing prerequisite",
  });
  expect(current.state).toBe("paused");
  expect(store.list()[0]?.completed).toBe(1);
  await expect(store.update({ ...update, revision: current.revision })).rejects.toThrow("resume");
});
it("repairs Markdown from its record and never resumes execution on reopen", async () => {
  const { root, store } = await setup();
  const plan = await store.create(draft, null);
  await store.action({ type: "accept", chatId: "chat", planId: plan.id, revision: 1 });
  await writeFile(join(root, "plans", `${plan.id}.md`), "interrupted projection");
  const reopened = await openPlanStore(root, "chat");
  expect(reopened.get(plan.id).state).toBe("paused");
  expect(await readFile(join(root, "plans", `${plan.id}.md`), "utf8")).toContain("- [ ] Implement");
  await expect(PlanStore.open(root, "another-chat")).rejects.toThrow("identity");
});
it("rejects links and preserves visible state on a failed write", async () => {
  const { root, store } = await setup();
  const plan = await store.create(draft, null);
  const directory = join(root, "outside");
  await mkdir(directory);
  const target = join(root, "outside.txt");
  await writeFile(target, "untouched");
  const path = join(root, "plans", `${plan.id}.md`);
  await rm(path);
  // Junctions exercise reparse-point refusal without requiring Windows elevation.
  await symlink(target, path, "file");
  await expect(
    store.action({ type: "accept", chatId: "chat", planId: plan.id, revision: 1 }),
  ).rejects.toThrow("Unsafe");
  expect(store.get(plan.id)).toEqual(plan);
  expect(await readFile(target, "utf8")).toBe("untouched");
  await expect(PlanStore.open(root, "chat")).rejects.toThrow("Unsafe");
});
it("rejects unknown fields, paths, empty tasks and evidence-free completion", () => {
  expect(planCreateSchema.safeParse({ ...draft, path: "../../bad" }).success).toBe(false);
  expect(planCreateSchema.safeParse({ ...draft, tasks: [] }).success).toBe(false);
  expect(
    planUpdateSchema.safeParse({
      operation: "progress",
      planId: randomUUID(),
      revision: 1,
      taskId: randomUUID(),
      state: "completed",
      note: " ",
    }).success,
  ).toBe(false);
  expect(() =>
    parsePlanAction({ type: "accept", chatId: "chat", planId: "../plan", revision: 1 }),
  ).toThrow();
});

it("rolls back the document if its record cannot be committed", async () => {
  const { root, store } = await setup();
  const plan = await store.create(draft, null);
  const markdown = join(root, "plans", `${plan.id}.md`);
  const before = await readFile(markdown, "utf8");
  const path = join(root, ".code60", "plans", `${plan.id}.json`);
  const directory = join(root, "outside");
  await mkdir(directory);
  const target = join(root, "unrelated.txt");
  await writeFile(target, "untouched");
  await rm(path);
  // Junctions exercise reparse-point refusal without requiring Windows elevation.
  await symlink(target, path, "file");
  await expect(
    store.update({
      operation: "revise",
      planId: plan.id,
      revision: 1,
      draft: { title: "Changed", description: "", tasks: [{ text: "New task" }] },
    }),
  ).rejects.toThrow("Unsafe");
  expect(store.get(plan.id)).toEqual(plan);
  expect(await readFile(markdown, "utf8")).toBe(before);
  expect(await readFile(target, "utf8")).toBe("untouched");
});

it.each([false, true])(
  "persists creation order through rewrites and repeated reopen (private %s)",
  async (strict) => {
    const { root } = await setup();
    let store = await openPlanStore(root, "chat", strict);
    const first = await store.create(draft, null);
    await store.action({ type: "dismiss", chatId: "chat", planId: first.id, revision: 1 });
    const latest = await store.create({ ...draft, requestId: "latest", title: "Latest" }, null);
    await store.action({ type: "accept", chatId: "chat", planId: latest.id, revision: 1 });
    await store.mutate(latest.id, (plan) => {
      plan.state = "completed";
    });
    // Older plans may have more revisions and newer modification times.
    for (let index = 0; index < 4; index++)
      await store.mutate(first.id, (plan) => {
        plan.description += " older edit";
      });
    const metadata = join(root, ".code60", "plans");
    // Force UUID enumeration to disagree with creation order without depending on random IDs.
    const earlyId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const lateId = "00000000-0000-4000-8000-000000000000";
    const expected = [store.get(first.id), store.get(latest.id)].map((plan, index) => ({
      ...plan,
      id: index ? lateId : earlyId,
    }));
    for (const plan of [first, latest]) await rm(join(metadata, `${plan.id}.json`));
    for (const plan of expected)
      await writeFile(join(metadata, `${plan.id}.json`), JSON.stringify(plan), { mode: 0o600 });
    await utimes(join(metadata, `${earlyId}.json`), new Date(2030, 1), new Date(2030, 1));
    const documents = await Promise.all(
      [first, latest].map((plan) => readFile(join(root, "plans", `${plan.id}.md`), "utf8")),
    );
    for (let restart = 0; restart < 3; restart++) {
      store = await openPlanStore(root, "chat", strict);
      expect(store.list().map((plan) => plan.id)).toEqual([earlyId, lateId]);
      expect(store.get(lateId)).toEqual(expected[1]);
      expect(store.get(earlyId)).toEqual(expected[0]);
      for (const [index, plan] of expected.entries())
        expect(await readFile(join(root, "plans", `${plan.id}.md`), "utf8")).toBe(documents[index]);
    }
    await store.rewind([store.get(earlyId)]);
    const next = await store.create({ ...draft, requestId: "after-undo" }, null);
    expect(next.creationOrder).toBe(3);
  },
);

it("rejects altered or duplicate creation order", async () => {
  const { root, store } = await setup();
  const first = await store.create(draft, null);
  await expect(
    store.mutate(first.id, (plan) => {
      plan.creationOrder = 2;
    }),
  ).rejects.toThrow("cannot change");
  expect(store.get(first.id)).toEqual(first);
  await store.action({ type: "dismiss", chatId: "chat", planId: first.id, revision: 1 });
  const second = await store.create({ ...draft, requestId: "second" }, null);
  const path = join(root, ".code60", "plans", `${second.id}.json`);
  await writeFile(path, JSON.stringify({ ...second, creationOrder: first.creationOrder }));
  await expect(PlanStore.open(root, "chat")).rejects.toThrow("Duplicate plan creation order");
});

it("persists, revises, clears, and renders structured plan sections and task metadata", async () => {
  const { root, store } = await setup();
  const structured = {
    requestId: "structured-1",
    title: "Improve plans",
    description: "Unify planning prompts and render structured sections.",
    outOfScope: ["Changing worker scheduling"],
    assumptions: ["Existing format 1 records stay valid"],
    verification: ["npm run check passes"],
    tasks: [
      {
        text: "Extend plan schema",
        details: "Update src/bridge/plans.ts and src/application/plans.ts",
        verify: "PlanStore unit tests pass",
      },
      { text: "Update PlanPanel" },
    ],
  };
  const created = await store.create(structured, "/project");
  expect(created.outOfScope).toEqual(["Changing worker scheduling"]);
  expect(created.assumptions).toEqual(["Existing format 1 records stay valid"]);
  expect(created.verification).toEqual(["npm run check passes"]);
  expect(created.tasks[0]).toMatchObject({
    text: "Extend plan schema",
    details: "Update src/bridge/plans.ts and src/application/plans.ts",
    verify: "PlanStore unit tests pass",
  });
  expect(created.tasks[1]).not.toHaveProperty("details");
  expect(created.tasks[1]).not.toHaveProperty("verify");

  const markdown = await readFile(join(root, "plans", `${created.id}.md`), "utf8");
  expect(markdown).toContain("## Out of scope\n\n- Changing worker scheduling");
  expect(markdown).toContain(
    "## Assumptions & open questions\n\n- Existing format 1 records stay valid",
  );
  expect(markdown).toContain("## Tasks\n\n- [ ] Extend plan schema");
  expect(markdown).toContain("  Details: Update src/bridge/plans.ts and src/application/plans.ts");
  expect(markdown).toContain("  Verify: PlanStore unit tests pass");
  expect(markdown).toContain("## Verification & completion criteria\n\n- npm run check passes");

  const revised = await store.update({
    operation: "revise",
    planId: created.id,
    revision: created.revision,
    draft: {
      title: "Improve plans v2",
      description: "Revised scope.",
      assumptions: ["Updated assumption"],
      tasks: [{ id: created.tasks[0]?.id, text: "Extend plan schema" }],
    },
  });
  expect(revised.outOfScope).toBeUndefined();
  expect(revised.assumptions).toEqual(["Updated assumption"]);
  expect(revised.verification).toBeUndefined();
  expect(revised.tasks[0]?.details).toBeUndefined();
  expect(revised.tasks[0]?.verify).toBeUndefined();

  const revisedMarkdown = await readFile(join(root, "plans", `${created.id}.md`), "utf8");
  expect(revisedMarkdown).not.toContain("## Out of scope");
  expect(revisedMarkdown).toContain("## Assumptions & open questions\n\n- Updated assumption");
  expect(revisedMarkdown).not.toContain("## Verification & completion criteria");

  expect(planCreateSchema.safeParse({ ...structured, outOfScope: ["  "] }).success).toBe(false);
  expect(
    planCreateSchema.safeParse({
      ...structured,
      tasks: [{ text: "Step", details: "  " }],
    }).success,
  ).toBe(false);
  expect(
    planCreateSchema.safeParse({
      ...structured,
      tasks: [{ text: "Step", verify: "  " }],
    }).success,
  ).toBe(false);
});
