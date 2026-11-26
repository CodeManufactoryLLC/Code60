import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
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
} from "../bridge/index.js";
import { type CoreDeps, defaultDeps } from "../core/index.js";
import { workflowContext } from "./workflow-context.js";
import {
  DesktopWorkflows,
  inspectWorkflowRecordsForUninstall,
  verifyOfflineWorkflowsIdleForUninstall,
  type WorkflowProviderPorts,
} from "./workflows.js";

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

type AgentSessionLike = Awaited<ReturnType<CoreDeps["agents"]["start"]>>;
type UpdateListener = Parameters<AgentSessionLike["onUpdate"]>[0];
type PermissionHandler = Parameters<AgentSessionLike["onPermission"]>[0];

async function fixture(options?: { failStart?: boolean }) {
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

  let failStart = options?.failStart ?? false;
  let releaseWorker: (() => void) | undefined;
  let workerPrompts = 0;
  const startedSpecs: { name: string; cwd: string }[] = [];
  const startAgent = vi.fn(async (spec: Parameters<CoreDeps["agents"]["start"]>[0]) => {
    startedSpecs.push({ name: spec.name, cwd: spec.cwd });
    if (failStart) throw new Error("provider unavailable");
    const listeners = new Set<UpdateListener>();
    let permHandler: PermissionHandler | undefined;
    let resolveExit: () => void = () => {};
    let cancelled = false;
    const exited = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    const session: AgentSessionLike = {
      sessionId: randomUUID(),
      pid: 12345,
      exited,
      onUpdate(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      onPermission(fn) {
        permHandler = fn;
      },
      async prompt(text) {
        const emit = (u: Parameters<UpdateListener>[0]) => {
          for (const listener of listeners) listener(u);
        };
        if (text.startsWith("Implement")) {
          emit({
            type: "toolCall",
            toolCallId: "t1",
            title: "Edit file",
            kind: "edit",
            status: "completed",
          });
          await new Promise<void>((resolve) => {
            releaseWorker = resolve;
            workerPrompts++;
          });
          if (cancelled) return "cancelled";
          if (permHandler) {
            await permHandler(
              {
                toolCallId: "p1",
                title: "Write file",
                kind: "edit",
                options: [{ optionId: "opt-allow", name: "Allow", kind: "allow_once" }],
              },
              new AbortController().signal,
            );
          }
          await writeFile(join(spec.cwd, "file.txt"), "updated\n");
          emit({
            type: "message",
            text: JSON.stringify({ kind: "result", summary: "Implemented" }),
          });
          return "end_turn";
        }
        emit({
          type: "message",
          text: JSON.stringify({
            kind: "verdict",
            decision: "accept",
            reason: "Verified",
            checks: [{ command: "npm test", passed: true, evidence: "ok" }],
          }),
        });
        return "end_turn";
      },
      async cancel() {
        cancelled = true;
        releaseWorker?.();
      },
      async stop() {
        cancelled = true;
        releaseWorker?.();
        resolveExit();
      },
      stderrTail: () => "",
    };
    return session;
  });

  const base = defaultDeps();
  const deps: CoreDeps = { ...base, agents: { start: startAgent } };
  const generate = vi.fn(
    async (_input: string, _signal: AbortSignal): Promise<WorkflowDraftReply> => ({
      message: "Prepared",
      draft: { name: "Generated", tasks: [task] },
    }),
  );
  const env = { XDG_STATE_HOME: join(root, "state") };
  const pick = vi.fn(async () => repo);
  let providerReady = true;
  const providers: WorkflowProviderPorts = {
    list: () => ({
      providers: [
        { id: "codex", name: "Codex", ready: providerReady },
        { id: "claude", name: "Claude", ready: providerReady },
      ],
      defaultProvider: providerReady ? "codex" : null,
    }),
    resolve: (providerId, cwd) => {
      const target = providerId || "codex";
      if (!providerReady) throw new Error(`Provider '${target}' is not verified.`);
      return { name: target, command: [target], cwd };
    },
  };
  const open = () => {
    const service = new DesktopWorkflows(env, deps, pick, generate, providers);
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
    provider: "claude",
    tasks: [task],
    repairs: 2,
    retries: 2,
    autoApprove: true,
  };
  const approve = async (revision = 0, override?: Partial<WorkflowDraft>) =>
    service.request({
      action: "review",
      formId,
      revision,
      draft: { ...draft, ...override },
    }) as Promise<WorkflowReview>;
  const start = async (override?: Partial<WorkflowDraft>) => {
    const review = await approve(0, override);
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
    startAgent,
    startedSpecs,
    draft,
    formId,
    choice,
    approve,
    start,
    generate,
    pick,
    open,
    workerPrompts: () => workerPrompts,
    release: () => releaseWorker?.(),
    setFailStart: (v: boolean) => {
      failStart = v;
    },
    setProviderReady: (v: boolean) => {
      providerReady = v;
    },
  };
}

it("reviews without execution and starts an isolated saved-files checkout idempotently with chosen provider", async () => {
  const f = await fixture();
  const head = git(f.repo, "rev-parse", "HEAD");
  const index = await readFile(join(f.repo, ".git/index"));
  const review = await f.approve();
  expect(f.startAgent).not.toHaveBeenCalled();
  expect(git(f.repo, "worktree", "list", "--porcelain")).not.toContain("code60/workflow-");
  const request = { action: "start", formId: f.formId, revision: 0, approvalId: review.approvalId };
  const record = (await f.service.request(request)) as WorkflowRecord;
  expect(((await f.service.request(request)) as WorkflowRecord).id).toBe(record.id);
  expect(record.snapshot?.provider).toBe("claude");
  await vi.waitFor(() => expect(f.startAgent).toHaveBeenCalledTimes(1));
  expect(f.startedSpecs[0]?.name).toBe("claude");
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
  await f.service.request({ action: "cancel", id: record.id });
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
  expect(f.startAgent).not.toHaveBeenCalled();
  await expect(
    f.service.request({ action: "review", formId: randomUUID(), revision: 0, draft: f.draft }),
  ).rejects.toThrow("Choose");
});

it("streams events, completes with accepted diff, supports pause/resume, and cancels without deleting worktrees", async () => {
  const f = await fixture();
  const record = await f.start();
  await vi.waitFor(() => expect(f.startAgent).toHaveBeenCalledTimes(1));
  await f.service.request({ action: "message", id: record.id, message: "More tests" });
  const events = (await f.service.request({
    action: "events",
    id: record.id,
    after: 0,
  })) as { events: { kind: string }[] };
  expect(events.events.length).toBeGreaterThan(0);

  const paused = (await f.service.request({ action: "pause", id: record.id })) as WorkflowRecord;
  expect(paused.snapshot?.status).toBe("paused");
  const resumed = (await f.service.request({ action: "resume", id: record.id })) as WorkflowRecord;
  expect(resumed.snapshot?.status).toBe("running");

  await vi.waitFor(() => expect(f.workerPrompts()).toBe(2));
  f.release();
  await vi.waitFor(async () => {
    const read = (await f.service.request({ action: "read", id: record.id })) as WorkflowRead;
    expect(read.record.snapshot?.status).toBe("completed");
  });
  const diff = (await f.service.request({ action: "diff", id: record.id, offset: 0 })) as {
    content: string;
    nextOffset: number | null;
  };
  expect(Buffer.from(diff.content, "base64").toString("utf8")).toContain("+updated");
  expect(diff.nextOffset).toBeNull();
  expect(await readFile(join(record.worktree, "file.txt"), "utf8")).toBe("updated\n");
});

it("lists available providers and cancels running workflows cleanly", async () => {
  const f = await fixture();
  const list = (await f.service.request({ action: "list" })) as WorkflowList;
  expect(list.defaultProvider).toBe("codex");
  expect(list.providers.map((p) => p.id)).toEqual(["codex", "claude"]);
  const record = await f.start();
  await vi.waitFor(() => expect(f.startAgent).toHaveBeenCalledTimes(1));
  const cancelled = (await f.service.request({
    action: "cancel",
    id: record.id,
  })) as WorkflowRecord;
  expect(cancelled.snapshot?.status).toBe("cancelled");
  expect(await readFile(join(record.worktree, "file.txt"), "utf8")).toBe("saved\n");
});

it("retains accepted records across close and refuses redirected worktree identities", async () => {
  const f = await fixture();
  const record = await f.start();
  await vi.waitFor(() => expect(f.startAgent).toHaveBeenCalledTimes(1));
  await f.service.request({ action: "cancel", id: record.id });
  await f.service.close();
  services.splice(services.indexOf(f.service), 1);
  const reopened = f.open();
  expect(((await reopened.request({ action: "list" })) as WorkflowList).entries[0]?.id).toBe(
    record.id,
  );
  // Keep the old inode allocated while modeling directory replacement.
  await rename(record.worktree, `${record.worktree}.original`);
  await mkdir(record.worktree);
  const read = (await reopened.request({ action: "read", id: record.id })) as WorkflowRead;
  expect(read.error).toContain("identity");
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
  expect(f.startAgent).not.toHaveBeenCalled();
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
    expect(f.startAgent).not.toHaveBeenCalled();
  },
);

it("rejects unknown workflow reads", async () => {
  const f = await fixture();
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
  expect(f.startAgent).not.toHaveBeenCalled();
});

it("refuses a second registry writer without displacing the current owner", async () => {
  const f = await fixture();
  const other = f.open();
  await expect(other.request({ action: "list" })).rejects.toThrow("already running");
  expect(((await f.service.request({ action: "list" })) as WorkflowList).entries).toEqual([]);
  expect(f.startAgent).not.toHaveBeenCalled();
});

it("preserves damaged registry evidence on reopen without launching agents", async () => {
  const f = await fixture();
  await f.service.close();
  services.splice(services.indexOf(f.service), 1);
  const path = join(f.service.root, "registry.json");
  await writeFile(path, "damaged evidence", { mode: 0o600 });
  const reopened = f.open();
  await expect(reopened.request({ action: "list" })).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe("damaged evidence");
  expect(f.startAgent).not.toHaveBeenCalled();
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
  expect(f.startAgent).not.toHaveBeenCalled();
  expect(git(f.repo, "worktree", "list", "--porcelain")).not.toContain(
    "branch refs/heads/code60/workflow-",
  );
  expect(await readFile(path, "utf8")).toBe("outside replacement");
});

it("inspects active and terminal saved workflows without launching agents or changing history", async () => {
  const f = await fixture();
  const { id } = await f.start();
  await vi.waitFor(() => expect(f.startAgent).toHaveBeenCalledTimes(1));
  const env = { XDG_STATE_HOME: join(f.root, "state") };
  const path = join(f.service.root, "registry.json");
  const before = await readFile(path);
  const calls = f.startAgent.mock.calls.length;
  expect(await inspectWorkflowRecordsForUninstall(env)).toEqual({
    completed: 0,
    active: 1,
    uncertain: 0,
  });
  expect(await readFile(path)).toEqual(before);
  expect(f.startAgent).toHaveBeenCalledTimes(calls);
  await f.service.request({ action: "cancel", id });
  expect(await inspectWorkflowRecordsForUninstall(env)).toEqual({
    completed: 1,
    active: 0,
    uncertain: 0,
  });
});

it("fences idle workflow requests, leaves approved active work alone and does not reopen after close", async () => {
  const f = await fixture();
  const release = await f.service.reserveIdleForUninstall();
  await expect(f.service.request({ action: "list" })).rejects.toThrow("closing");
  expect(f.startAgent).not.toHaveBeenCalled();
  await release();
  const { id } = await f.start();
  await vi.waitFor(() => expect(f.startAgent).toHaveBeenCalledTimes(1));
  const before = f.startAgent.mock.calls.length;
  await expect(f.service.reserveIdleForUninstall()).rejects.toThrow("Workflows are active");
  expect(f.startAgent).toHaveBeenCalledTimes(before);
  await f.service.request({ action: "cancel", id });
  const pending = await f.service.reserveIdleForUninstall();
  await f.service.close();
  await pending();
  await expect(f.service.request({ action: "list" })).rejects.toThrow("closing");
});

it("refuses an active draft without cancelling or applying it and releases a cancelled idle reservation", async () => {
  const f = await fixture();
  let resolve: (value: WorkflowDraftReply) => void = () => {};
  f.generate.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const draft = f.service.request({
    action: "draft",
    formId: f.formId,
    revision: 0,
    requestId: randomUUID(),
    fields: { name: "", tasks: [] },
    messages: [{ role: "user", text: "Plan the change" }],
  });
  await vi.waitFor(() => expect(f.generate).toHaveBeenCalled());
  await expect(f.service.reserveIdleForUninstall()).rejects.toThrow("preparation is active");
  resolve({ message: "Ready" });
  expect(await draft).toEqual({ message: "Ready" });
  await expect(
    f.service.reserveIdleForUninstall(AbortSignal.abort(Error("cancelled"))),
  ).rejects.toThrow("cancelled");
  const release = await f.service.reserveIdleForUninstall();
  await release();
  expect(await f.service.request({ action: "list" })).toMatchObject({ entries: [] });
});

it("refuses another workflow writer without reclaiming its lock", async () => {
  const f = await fixture();
  const second = f.open();
  await expect(second.reserveIdleForUninstall()).rejects.toThrow("writer ownership is uncertain");
  expect(f.startAgent).not.toHaveBeenCalled();
  expect(await f.service.request({ action: "list" })).toMatchObject({ entries: [] });
  await f.service.close();
  const release = await second.reserveIdleForUninstall();
  await release();
});

it("refuses a pending human repository choice promptly instead of blocking its answer", async () => {
  const f = await fixture();
  let resolve: (value: string) => void = () => {};
  f.pick.mockImplementationOnce(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  const choice = f.service.request({ action: "pickRepository", formId: randomUUID() });
  await vi.waitFor(() => expect(f.pick).toHaveBeenCalledTimes(2));
  try {
    await expect(f.service.reserveIdleForUninstall()).rejects.toThrow("preparation is pending");
  } finally {
    resolve(f.repo);
    await choice;
  }
  expect(f.startAgent).not.toHaveBeenCalled();
  const release = await f.service.reserveIdleForUninstall();
  await release();
});

it("never mistakes uncertain or pending-stop terminal snapshots for uninstall readiness", async () => {
  const f = await fixture();
  const { id } = await f.start();
  await vi.waitFor(() => expect(f.startAgent).toHaveBeenCalledTimes(1));
  await f.service.request({ action: "cancel", id });
  await f.service.close();
  const path = join(f.service.root, "registry.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  const env = { XDG_STATE_HOME: join(f.root, "state") };
  for (const patch of [
    { state: "uncertain" },
    { stopPending: true },
    { state: "preparation_failed" },
  ]) {
    const changed = structuredClone(saved);
    Object.assign(changed.entries[0], patch);
    const text = JSON.stringify(changed);
    await writeFile(path, text);
    const calls = f.startAgent.mock.calls.length;
    expect(await inspectWorkflowRecordsForUninstall(env)).toEqual({
      completed: 0,
      active: 0,
      uncertain: 1,
    });
    expect(await readFile(path, "utf8")).toBe(text);
    expect(f.startAgent).toHaveBeenCalledTimes(calls);
  }
});

it("refuses damaged or duplicate workflow evidence and creates no state on a fresh inspection", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "code60 inspect workflows ")));
  roots.push(root);
  const env = { XDG_STATE_HOME: join(root, "empty-state") };
  expect(await inspectWorkflowRecordsForUninstall(env)).toEqual({
    completed: 0,
    active: 0,
    uncertain: 0,
  });
  expect(await readdir(root)).toEqual([]);
  const f = await fixture();
  const { id } = await f.start();
  await vi.waitFor(() => expect(f.startAgent).toHaveBeenCalledTimes(1));
  await f.service.request({ action: "cancel", id });
  await f.service.close();
  const path = join(f.service.root, "registry.json");
  const saved = JSON.parse(await readFile(path, "utf8"));
  saved.entries.push(saved.entries[0]);
  await writeFile(path, JSON.stringify(saved));
  await expect(
    inspectWorkflowRecordsForUninstall({ XDG_STATE_HOME: join(f.root, "state") }),
  ).rejects.toThrow("duplicate ownership");
  const damaged = "private draft fixture that must never appear in errors";
  await writeFile(path, damaged);
  await expect(
    inspectWorkflowRecordsForUninstall({ XDG_STATE_HOME: join(f.root, "state") }),
  ).rejects.toThrow("Workflow history is unavailable; preserve state before uninstalling");
  expect(await readFile(path, "utf8")).toBe(damaged);
});

it("verifies a fresh offline uninstall without creating workflow state", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "code60 offline removal ")));
  roots.push(root);
  const env = { XDG_STATE_HOME: join(root, "state") };
  await expect(
    verifyOfflineWorkflowsIdleForUninstall(env, new AbortController().signal),
  ).resolves.toBeUndefined();
  expect(await readdir(root)).toEqual([]);
  await expect(
    verifyOfflineWorkflowsIdleForUninstall(env, AbortSignal.abort(Error("cancelled"))),
  ).rejects.toThrow("cancelled");
  expect(await readdir(root)).toEqual([]);
});

it("reserves an existing offline workflow writer without changing its empty registry", async () => {
  const f = await fixture();
  const env = { XDG_STATE_HOME: join(f.root, "state") };
  await expect(
    verifyOfflineWorkflowsIdleForUninstall(env, new AbortController().signal),
  ).rejects.toThrow("No lock was reclaimed");
  await f.service.close();
  const before = await readFile(join(f.service.root, "registry.json")).catch(() => null);
  const names = await readdir(f.service.root);
  await expect(
    verifyOfflineWorkflowsIdleForUninstall(env, new AbortController().signal),
  ).resolves.toBeUndefined();
  expect(await readdir(f.service.root)).toEqual(names);
  expect(await readFile(join(f.service.root, "registry.json")).catch(() => null)).toEqual(before);
  expect(f.startAgent).not.toHaveBeenCalled();
});

it.each(["active", "uncertain", "stale-writer"] as const)(
  "refuses offline uninstall with %s evidence before any history mutation",
  async (fault) => {
    const f = await fixture();
    const { id } = await f.start();
    await vi.waitFor(() => expect(f.startAgent).toHaveBeenCalledTimes(1));
    if (fault !== "active") await f.service.request({ action: "cancel", id });
    await f.service.close();
    const path = join(f.service.root, "registry.json");
    if (fault === "uncertain") {
      const record = JSON.parse(await readFile(path, "utf8"));
      record.entries[0].stopPending = true;
      await writeFile(path, JSON.stringify(record));
    }
    if (fault === "stale-writer") {
      await mkdir(join(f.service.root, ".writer"), { mode: 0o700 });
      await writeFile(
        join(f.service.root, ".writer/owner-1000000000-00000000-0000-4000-8000-000000000001"),
        "",
        { mode: 0o600 },
      );
    }
    const before = await readFile(path);
    const names = await readdir(f.service.root);
    const calls = f.startAgent.mock.calls.length;
    await expect(
      verifyOfflineWorkflowsIdleForUninstall(
        { XDG_STATE_HOME: join(f.root, "state") },
        new AbortController().signal,
      ),
    ).rejects.toThrow(fault === "stale-writer" ? "No lock was reclaimed" : "active or uncertain");
    expect(await readFile(path)).toEqual(before);
    expect(await readdir(f.service.root)).toEqual(names);
    expect(f.startAgent).toHaveBeenCalledTimes(calls);
  },
);
