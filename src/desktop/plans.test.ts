import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { parsePlanAction, planCreateSchema, planUpdateSchema } from "../bridge/index.js";
import { PlanStore } from "./plans.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const parent = await mkdtemp(join(tmpdir(), "code60-plan-"));
  roots.push(parent);
  const root = join(parent, "chat");
  return { root, store: await PlanStore.open(root, "chat") };
}
const draft = {
  requestId: "first",
  title: "Build",
  description: "A small change",
  tasks: [{ text: "Implement" }, { text: "Verify" }],
};
it("keeps Relay target assignments and rejects private-record changes instead of overwriting them", async () => {
  const parent = await mkdtemp(join(tmpdir(), "code60-private-plan-"));
  roots.push(parent);
  const root = join(parent, "documents");
  const store = await PlanStore.open(root, "relay", true);
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
  expect((await PlanStore.open(root, "relay", true)).get(plan.id).tasks[0]?.target).toEqual(target);
  if (process.platform !== "win32") {
    await chmod(path, 0o644);
    await expect(PlanStore.open(root, "relay", true)).rejects.toThrow("permissions");
  }
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
  const reopened = await PlanStore.open(root, "chat");
  expect(reopened.get(plan.id).state).toBe("paused");
  expect(await readFile(join(root, "plans", `${plan.id}.md`), "utf8")).toContain("- [ ] Implement");
  await expect(PlanStore.open(root, "another-chat")).rejects.toThrow("identity");
});
it("rejects links and preserves visible state on a failed write", async () => {
  const { root, store } = await setup();
  const plan = await store.create(draft, null);
  const target = join(root, "outside.txt");
  await writeFile(target, "untouched");
  const path = join(root, "plans", `${plan.id}.md`);
  await rm(path);
  await symlink(target, path);
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
  const target = join(root, "unrelated.txt");
  await writeFile(target, "untouched");
  await rm(path);
  await symlink(target, path);
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
