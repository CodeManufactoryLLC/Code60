import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type {
  WorkflowDraft,
  WorkflowDraftReply,
  WorkflowList,
  WorkflowRead,
  WorkflowRecord,
  WorkflowRepository,
  WorkflowReview,
  WorkflowSnapshot,
} from "../bridge/index.js";
import { defaultDeps } from "../core/index.js";
import type { TransmissionClient } from "./transmission.js";
import { workflowContext } from "./workflow-context.js";
import { DesktopWorkflows } from "./workflows.js";

const roots: string[] = [];
const services: DesktopWorkflows[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const task = {
  name: "Repair",
  instructions: "Fix the code",
  verify: "Exercise the API",
  checks: ["npm test"],
};
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "c60-workflow-unit-")));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  git(repo, "init", "-q");
  await writeFile(join(repo, "file.txt"), "original\n");
  git(repo, "add", ".");
  git(
    repo,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "base",
  );
  await writeFile(join(repo, "file.txt"), "staged\n");
  git(repo, "add", ".");
  await writeFile(join(repo, "file.txt"), "saved\n");
  await writeFile(join(repo, "new.txt"), "untracked\n");
  const snapshot: WorkflowSnapshot = {
    runId: randomUUID(),
    status: "running",
    tasks: [{ index: 0, name: task.name, state: "implementing" }],
    activeTaskIndex: 0,
    eventCursor: 1,
    accepted: [],
    attempts: [],
  };
  let fail = false;
  let mismatch = false;
  const call = vi.fn(async (operation: string, _args?: Record<string, unknown>) => {
    if (fail) throw new Error("offline");
    if (operation === "get_workflow_events")
      return {
        events: [{ sequence: 7, time: "2026-11-22", kind: "tool", detail: { detail: "fixture" } }],
      };
    if (operation === "get_workflow_diff")
      return { content: Buffer.from("diff fixture").toString("base64"), nextOffset: null };
    if (operation === "cancel_workflow") {
      snapshot.status = "cancelled";
      snapshot.activeTaskIndex = null;
      snapshot.eventCursor++;
      snapshot.tasks[0]!.state = "cancelled";
    }
    return mismatch ? { ...snapshot, tasks: [] } : structuredClone(snapshot);
  });
  const client: TransmissionClient = { supported: true, call, connect: vi.fn(async () => {}) };
  const generate = vi.fn(
    async (_input: string, _signal: AbortSignal): Promise<WorkflowDraftReply> => ({
      message: "Prepared",
      draft: { name: "Generated", tasks: [task] },
    }),
  );
  const env = { XDG_STATE_HOME: join(root, "state") };
  const deps = defaultDeps();
  const open = (legacyClient?: TransmissionClient) => {
    const service = new DesktopWorkflows(
      env,
      deps,
      async () => repo,
      generate,
      client,
      legacyClient,
    );
    services.push(service);
    return service;
  };
  const service = open();
  const formId = randomUUID();
  const choice = (await service.request({
    action: "pickRepository",
    formId,
  })) as WorkflowRepository;
  const draft: WorkflowDraft = {
    name: "Repair workflow",
    repositoryToken: choice.token,
    tasks: [task],
    repairs: 2,
    retries: 2,
    autoApprove: true,
  };
  const approve = async (revision = 0) =>
    service.request({ action: "review", formId, revision, draft }) as Promise<WorkflowReview>;
  const start = async () => {
    const review = await approve();
    return service.request({
      action: "start",
      formId,
      revision: 0,
      approvalId: review.approvalId,
    }) as Promise<WorkflowRecord>;
  };
  return {
    service,
    repo,
    root,
    client,
    call,
    snapshot,
    draft,
    formId,
    choice,
    approve,
    start,
    generate,
    open,
    offline: () => {
      fail = true;
    },
    online: () => {
      fail = false;
    },
    mismatch: () => {
      mismatch = true;
    },
  };
}
it("reviews without execution and starts an isolated saved-files checkout idempotently", async () => {
  const f = await fixture();
  const head = git(f.repo, "rev-parse", "HEAD");
  const index = await readFile(join(f.repo, ".git/index"));
  const review = await f.approve();
  expect(f.call).not.toHaveBeenCalled();
  expect(f.client.connect).not.toHaveBeenCalled();
  expect(git(f.repo, "worktree", "list", "--porcelain")).not.toContain("transmission-");
  const request = { action: "start", formId: f.formId, revision: 0, approvalId: review.approvalId };
  const record = (await f.service.request(request)) as WorkflowRecord;
  expect(((await f.service.request(request)) as WorkflowRecord).id).toBe(record.id);
  expect(f.call).toHaveBeenCalledTimes(1);
  expect(await readFile(join(record.worktree, "file.txt"), "utf8")).toBe("saved\n");
  expect(await readFile(join(record.worktree, "new.txt"), "utf8")).toBe("untracked\n");
  expect(await readFile(join(f.repo, "file.txt"), "utf8")).toBe("saved\n");
  expect(git(f.repo, "rev-parse", "HEAD")).toBe(head);
  expect(await readFile(join(f.repo, ".git/index"))).toEqual(index);
  const next = await f.approve(1);
  await expect(
    f.service.request({
      action: "start",
      formId: f.formId,
      revision: 1,
      approvalId: next.approvalId,
    }),
  ).rejects.toThrow("already active");
});
it("rejects stale approvals and malformed requests without authority", async () => {
  const f = await fixture();
  const approval = await f.approve();
  await f.service.request({ action: "invalidate", formId: f.formId, revision: 1 });
  await expect(
    f.service.request({
      action: "start",
      formId: f.formId,
      revision: 0,
      approvalId: approval.approvalId,
    }),
  ).rejects.toThrow("changed");
  await expect(f.service.request({ action: "start", cwd: f.repo })).rejects.toThrow();
  expect(f.call).not.toHaveBeenCalled();
  await expect(
    f.service.request({ action: "review", formId: randomUUID(), revision: 0, draft: f.draft }),
  ).rejects.toThrow("Choose");
});
it("keeps last-known status, validates evidence and cancels without deleting worktrees", async () => {
  const f = await fixture();
  const record = await f.start();
  expect(await f.service.request({ action: "events", id: record.id, after: 0 })).toMatchObject({
    events: [{ sequence: 7 }],
  });
  expect(await f.service.request({ action: "diff", id: record.id, offset: 0 })).toMatchObject({
    nextOffset: null,
  });
  await f.service.request({ action: "message", id: record.id, message: "More tests" });
  await f.service.request({
    action: "answer",
    id: record.id,
    questionId: randomUUID(),
    answer: "option-1",
  });
  f.offline();
  const read = (await f.service.request({ action: "read", id: record.id })) as WorkflowRead;
  expect(read.connected).toBe(false);
  expect(read.record.snapshot?.status).toBe("running");
  f.online();
  expect(
    ((await f.service.request({ action: "read", id: record.id })) as WorkflowRead).connected,
  ).toBe(true);
  const cancelled = (await f.service.request({
    action: "cancel",
    id: record.id,
  })) as WorkflowRecord;
  expect(cancelled.snapshot?.status).toBe("cancelled");
  expect(await readFile(join(record.worktree, "file.txt"), "utf8")).toBe("saved\n");
});
it("preserves an uncertain start and recovers only the same key and payload", async () => {
  const f = await fixture();
  f.offline();
  await expect(f.start()).rejects.toThrow("unconfirmed");
  const list = (await f.service.request({ action: "list" })) as WorkflowList;
  const record = list.entries[0]!;
  expect(record.state).toBe("uncertain");
  const original = f.call.mock.calls[0];
  f.online();
  await f.service.request({ action: "recover", id: record.id });
  expect(f.call.mock.calls[1]).toEqual(original);
  await f.service.close();
  services.splice(services.indexOf(f.service), 1);
  const reopened = f.open();
  const saved = (await reopened.request({ action: "list" })) as WorkflowList;
  expect(saved.entries[0]?.snapshot?.runId).toBe(f.snapshot.runId);
  expect(f.client.connect).toHaveBeenCalledTimes(1);
});
it("retains accepted records across desktop close, and refuses redirected worktree identities", async () => {
  const f = await fixture();
  const record = await f.start();
  await f.service.close();
  services.splice(services.indexOf(f.service), 1);
  const reopened = f.open();
  expect(((await reopened.request({ action: "list" })) as WorkflowList).entries[0]?.id).toBe(
    record.id,
  );
  expect(f.call).toHaveBeenCalledTimes(1);
  // Keep the old inode allocated while modeling directory replacement.
  await rename(record.worktree, record.worktree + ".original");
  await mkdir(record.worktree);
  const read = (await reopened.request({ action: "read", id: record.id })) as WorkflowRead;
  expect(read.connected).toBe(false);
  await expect(reopened.request({ action: "cancel", id: record.id })).rejects.toThrow("identity");
});
it("drafts only name/tasks with bounded root context and rejects unsafe context files", async () => {
  const f = await fixture();
  await writeFile(join(f.repo, "README.md"), "Project overview");
  await writeFile(
    join(f.repo, "package.json"),
    JSON.stringify({ scripts: { test: "vitest" }, secret: "not included" }),
  );
  const result = await f.service.request({
    action: "draft",
    formId: f.formId,
    revision: 0,
    requestId: randomUUID(),
    repositoryToken: f.choice.token,
    fields: { name: "", tasks: [] },
    messages: [{ role: "user", text: "Fix duration parsing" }],
  });
  expect(result).toMatchObject({ draft: { name: "Generated" } });
  expect(f.call).not.toHaveBeenCalled();
  expect(f.generate.mock.calls[0]?.[0]).toContain("vitest");
  expect(f.generate.mock.calls[0]?.[0]).not.toContain("not included");
  await rm(join(f.repo, "README.md"));
  await symlink(join(f.repo, "file.txt"), join(f.repo, "README.md"));
  await expect(workflowContext(f.repo)).rejects.toThrow("Unsafe");
});
it.each(["invalidate", "cancelDraft", "reset", "provider"])(
  "cancels draft generation on %s and never applies stale fields",
  async (mode) => {
    const f = await fixture();
    let resolve: (value: { message: string }) => void = () => {};
    f.generate.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const requestId = randomUUID();
    const pending = f.service.request({
      action: "draft",
      formId: f.formId,
      revision: 0,
      requestId,
      fields: { name: "", tasks: [] },
      messages: [{ role: "user", text: "Fix it" }],
    });
    const rejection = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(f.generate).toHaveBeenCalled());
    let done: Promise<unknown> = Promise.resolve();
    if (mode === "reset") done = f.service.reset();
    else if (mode === "provider") f.service.observeProvider("new-provider");
    else
      done = f.service.request(
        mode === "invalidate"
          ? { action: mode, formId: f.formId, revision: 1 }
          : { action: mode, formId: f.formId, requestId },
      );
    resolve({ message: "Late result" });
    await done;
    await rejection;
    expect(f.call).not.toHaveBeenCalled();
  },
);
it("rejects malformed snapshots and unknown workflow reads without losing saved status", async () => {
  const f = await fixture();
  const record = await f.start();
  f.mismatch();
  expect(await f.service.request({ action: "read", id: record.id })).toMatchObject({
    connected: false,
    record: { snapshot: { status: "running" } },
  });
  await expect(f.service.request({ action: "read", id: randomUUID() })).rejects.toThrow("Unknown");
});

it("revokes a disposed form's picker and approval capabilities", async () => {
  const f = await fixture();
  const review = await f.approve();
  await f.service.request({ action: "disposeForm", formId: f.formId });
  await expect(
    f.service.request({
      action: "start",
      formId: f.formId,
      revision: 0,
      approvalId: review.approvalId,
    }),
  ).rejects.toThrow("changed");
  await expect(f.approve()).rejects.toThrow("Choose");
  expect(f.call).not.toHaveBeenCalled();
});

it("refuses a second registry writer without displacing the current owner", async () => {
  const f = await fixture();
  const other = f.open();
  await expect(other.request({ action: "list" })).rejects.toThrow("already running");
  expect(((await f.service.request({ action: "list" })) as WorkflowList).entries).toEqual([]);
  expect(f.call).not.toHaveBeenCalled();
});
it("preserves damaged registry evidence on reopen without starting the engine", async () => {
  const f = await fixture();
  await f.service.close();
  services.splice(services.indexOf(f.service), 1);
  const path = join(f.service.root, "registry.json");
  await writeFile(path, "damaged evidence", { mode: 0o600 });
  const reopened = f.open();
  await expect(reopened.request({ action: "list" })).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe("damaged evidence");
  expect(f.client.connect).not.toHaveBeenCalled();
});
it("refuses an outside registry replacement before worktree preparation or dispatch", async () => {
  const f = await fixture();
  const approval = await f.approve();
  const path = join(f.service.root, "registry.json");
  await writeFile(path, "outside replacement", { mode: 0o600 });
  await expect(
    f.service.request({
      action: "start",
      formId: f.formId,
      revision: 0,
      approvalId: approval.approvalId,
    }),
  ).rejects.toThrow("already exists");
  expect(f.call).not.toHaveBeenCalled();
  expect(git(f.repo, "worktree", "list", "--porcelain")).not.toContain(
    "branch refs/heads/code60/transmission-",
  );
  expect(await readFile(path, "utf8")).toBe("outside replacement");
});

it("keeps unversioned history, control, reconnect and uncertain recovery on staging.18", async () => {
  const f = await fixture();
  const record = await f.start();
  expect(record.engineVersion).toBe("0.1.0-staging.20");
  await f.service.close();
  services.splice(services.indexOf(f.service), 1);
  const path = join(f.service.root, "registry.json");
  const old = structuredClone(record);
  delete old.engineVersion;
  delete old.snapshot;
  old.state = "uncertain";
  await writeFile(path, JSON.stringify({ format: 1, version: "0.1.0-staging.18", entries: [old] }));
  const legacy = {
    supported: true,
    call: vi.fn(f.call.getMockImplementation()!),
    connect: vi.fn(async () => {}),
  };
  const reopened = f.open(legacy);
  expect(await reopened.request({ action: "list" })).toMatchObject({
    entries: [{ id: old.id, key: old.key }],
  });
  expect(legacy.connect).not.toHaveBeenCalled();
  await reopened.request({ action: "reconnect", id: old.id });
  await reopened.request({ action: "recover", id: old.id });
  expect(legacy.call.mock.calls[0]?.slice(0, 2)).toEqual(f.call.mock.calls[0]?.slice(0, 2));
  await reopened.request({ action: "read", id: old.id });
  for (const action of ["pause", "resume"])
    await expect(reopened.request({ action, id: old.id })).rejects.toThrow("staging.20");
  await reopened.request({ action: "cancel", id: old.id });
  expect(legacy.call.mock.calls.map(([op]) => op)).toEqual([
    "start_workflow",
    "get_workflow",
    "cancel_workflow",
  ]);
  expect(f.call).toHaveBeenCalledTimes(1);
});

it("retains a pending stop after a lost acknowledgement until cleanup is confirmed", async () => {
  const f = await fixture();
  const { id } = await f.start();
  f.offline();
  await expect(f.service.request({ action: "cancel", id })).rejects.toThrow();
  f.online();
  f.snapshot.status = "cancelled";
  f.snapshot.activeTaskIndex = null;
  f.snapshot.eventCursor++;
  expect(await f.service.request({ action: "read", id })).toMatchObject({
    record: { stopPending: true, snapshot: { status: "cancelled" } },
  });
  await expect(f.service.request({ action: "resume", id })).rejects.toThrow("acknowledgement");
  expect(await f.service.request({ action: "cancel", id })).not.toHaveProperty("stopPending");
});
