import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Plan } from "../src/bridge/index.js";
import { DEFAULT_CONFIG, defaultDeps } from "../src/core/index.js";
import { RelayService } from "../src/desktop/relay-service.js";
import { RelayStore } from "../src/desktop/relay-store.js";
import { FakeAgents, FakeGit, FakeProcesses, flush } from "./fakes.js";

let root: string;
let agents: FakeAgents;
let relay: RelayService;
let services: RelayService[];
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing test fixture value");
  return value;
}
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "code60-relay-service-")));
  agents = new FakeAgents();
  services = [];
  relay = create();
  await mkdir(join(root, "target"));
});
function create(beforeMkdir?: () => Promise<void>, notify: () => void = vi.fn()) {
  const deps = defaultDeps();
  const git = new FakeGit();
  git.repoInfo = async () => {
    throw new Error("not Git");
  };
  const service = new RelayService(
    {
      ...deps,
      fs: {
        ...deps.fs,
        mkdir: async (path, options) => {
          await beforeMkdir?.();
          return deps.fs.mkdir(path, options);
        },
      },
      agents,
      git,
      processes: new FakeProcesses(),
    },
    { XDG_STATE_HOME: join(root, "state") },
    notify,
  );
  services.push(service);
  return service;
}
afterEach(async () => {
  await Promise.allSettled(services.map((service) => service.shutdown(true)));
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
async function connect() {
  await relay.sync("claude", {
    ...DEFAULT_CONFIG,
    agents: { claude: required(DEFAULT_CONFIG.agents.claude) },
  });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
}
it.each(["removed", "replaced", "symlink"])(
  "refuses a %s workspace on in-process Retry",
  async (kind) => {
    if (kind === "symlink" && process.platform === "win32") return;
    await connect();
    const workspace = required(relay.snapshot().directory);
    await relay.action({ type: "stop", id: required(relay.snapshot().run).id });
    await rename(workspace, `${workspace}-saved`);
    if (kind === "replaced") await mkdir(workspace, { mode: 0o700 });
    if (kind === "symlink") await symlink(join(root, "target"), workspace);
    const launches = agents.specs.length;
    await relay.action({ type: "restart", id: required(relay.snapshot().conversationId) });
    expect(relay.snapshot().error).toBeTruthy();
    expect(agents.specs).toHaveLength(launches);
    if (kind === "removed") await expect(stat(workspace)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
it("revalidates workspace identity between preparation and agent launch", async () => {
  let replace = false;
  relay = create(async () => {
    if (!replace) return;
    replace = false;
    const workspace = required(relay.snapshot().directory);
    await rename(workspace, `${workspace}-saved`);
    await mkdir(workspace, { mode: 0o700 });
  });
  await connect();
  await relay.action({ type: "stop", id: required(relay.snapshot().run).id });
  const launches = agents.specs.length;
  replace = true;
  await relay.action({ type: "restart", id: required(relay.snapshot().conversationId) });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("failed"));
  expect(agents.specs).toHaveLength(launches);
});
it.each(["constructor", "__proto__", "toString"])(
  "rejects inherited provider %s before preparation",
  async (provider) => {
    await connect();
    await relay.action({ type: "send", id: required(relay.snapshot().run).id, text: "Task" });
    await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
    const { scope } = await tool("code60_get_context");
    const launches = agents.specs.length;
    await expect(
      tool("code60_dispatch_agent", {
        scope,
        requestId: provider,
        cwd: join(root, "target"),
        workspaceMode: "direct",
        provider,
        prompt: "Must not start",
      }),
    ).rejects.toThrow("Unavailable verified provider");
    expect(relay.execution.list()).toEqual([]);
    expect(agents.specs).toHaveLength(launches);
  },
);
it("keeps observer failures outside accepted prompts, worker dispatch and cleanup", async () => {
  relay = create(undefined, () => {
    throw new Error("Observer failed");
  });
  await connect();
  await relay.action({ type: "send", id: required(relay.snapshot().run).id, text: "Start work" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const { scope } = await tool("code60_get_context");
  const result = await tool("code60_dispatch_agent", {
    scope,
    requestId: "observer-worker",
    cwd: join(root, "target"),
    workspaceMode: "direct",
    prompt: "Accepted exactly once",
  });
  expect(result.runId).toEqual(expect.any(String));
  expect(relay.workerSnapshot().runs).toHaveLength(1);
  await expect(relay.shutdown(true)).resolves.toBeUndefined();
});
it("advances only the changed target's detail version during worker follow-ups", async () => {
  await mkdir(join(root, "other"));
  await connect();
  await relay.action({ type: "send", id: required(relay.snapshot().run).id, text: "Two targets" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const { scope } = await tool("code60_get_context");
  for (const name of ["target", "other"])
    await tool("code60_dispatch_agent", {
      scope,
      requestId: name,
      cwd: join(root, name),
      workspaceMode: "direct",
      prompt: name,
    });
  await vi.waitFor(() => {
    expect(relay.workerSnapshot().runs.every((run) => run.view?.status === "idle")).toBe(true);
    expect(relay.snapshot().updates?.pending).toBe(0);
    expect(relay.snapshot().run?.status).toBe("idle");
  });
  const [a, b] = relay.execution.list();
  if (!a || !b) throw new Error("Missing targets");
  const aVersion = relay.detailVersion(a.target.id);
  const bVersion = relay.detailVersion(b.target.id);
  await relay.workerAction({ type: "reply", id: b.id, text: "Target B follow-up" });
  await vi.waitFor(() =>
    expect(b.orchestrator.runs()[0]).toMatchObject({ status: "idle", turns: 2 }),
  );
  expect(relay.detailVersion(a.target.id)).toBe(aVersion);
  expect(relay.detailVersion(b.target.id)).toBeGreaterThan(bVersion);
});
async function tool(name: string, args: unknown = {}) {
  const spec = agents.specs.findLast((spec) =>
    spec.mcpServers?.some((server) => server.name === "code60"),
  );
  const server = spec?.mcpServers?.find((server) => server.name === "code60");
  if (!server || "type" in server) throw new Error("Missing Relay gateway");
  const env = Object.fromEntries((server.env ?? []).map(({ name, value }) => [name, value]));
  const response = await fetch(required(env.CODE60_MCP_GATEWAY_URL), {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.CODE60_MCP_GATEWAY_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name, arguments: args }),
  });
  const body = (await response.json()) as { error?: string; result?: unknown };
  if (!response.ok) throw new Error(body.error);
  return body.result as Record<string, unknown>;
}
async function propose(target = join(root, "target")) {
  const request = {
    requestId: "proposal",
    title: "Explicit work",
    description: "Review targets before accepting",
    tasks: [
      { text: "Change the target", target: { cwd: target, workspaceMode: "direct" as const } },
    ],
  };
  return { request, plan: (await tool("code60_create_plan", request)) as unknown as Plan };
}
it("pushes compact worker reply counters without transcript or original-prompt bodies", async () => {
  agents.script = (_text, session) => (session.pid === 1000 ? "end_turn" : "hang");
  await connect();
  await relay.action({ type: "send", id: required(relay.snapshot().run).id, text: "Start work" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const { scope } = await tool("code60_get_context");
  const result = await tool("code60_dispatch_agent", {
    requestId: "compact-worker",
    scope,
    cwd: join(root, "target"),
    workspaceMode: "direct",
    prompt: "Original worker prompt ".repeat(1_000),
  });
  await vi.waitFor(() => expect(agents.sessions.at(-1)?.turnActive).toBe(true));
  const worker = required(agents.sessions.at(-1));
  worker.update({ type: "message", text: "😀".repeat(40_000) });
  worker.update({ type: "message", text: "Additional worker chunk" });
  expect(relay.workerSnapshot(true)).toMatchObject({
    events: [],
    runs: [{ record: { id: result.runId, firstPrompt: "" }, replies: { count: 1, lastTurn: 1 } }],
  });
  expect(JSON.stringify(relay.workerSnapshot(true)).length).toBeLessThan(8_000);
  expect(relay.workerSnapshot().runs[0]?.record.firstPrompt).toContain("Original worker prompt");
  expect(
    relay
      .workerSnapshot()
      .events.some(
        ({ event }) => event.type === "message" && event.text === "Additional worker chunk",
      ),
  ).toBe(true);
  const owned = required(relay.execution.list()[0]);
  const disk = vi
    .spyOn(owned.workspace.store, "readEvents")
    .mockRejectedValue(new Error("Lifetime read forbidden"));
  for (let i = 0; i < 600; i++) {
    worker.update({ type: "message", text: `Chunk ${i}` });
    worker.update({ type: "thought", text: `Thought ${i}` });
  }
  const page = await tool("code60_read_agent", { runId: result.runId, limit: 2, tail: true });
  expect(page).toMatchObject({
    incomplete: true,
    windowRevision: expect.any(Number),
    nextCursor: null,
  });
  expect(page.entries).toHaveLength(2);
  expect(JSON.stringify(page.entries)).toContain("599");
  expect(disk).not.toHaveBeenCalled();
});
it("requires human acceptance of the latest Relay revision and enforces its exact target and mode", async () => {
  agents.script = (_text, session) => (session.pid === 1000 ? "end_turn" : "hang");
  await connect();
  const id = required(relay.snapshot().run).id;
  await relay.action({ type: "send", id, text: "Propose target work" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  await expect(
    tool("code60_create_plan", {
      requestId: "missing-target",
      title: "Missing",
      description: "",
      tasks: [{ text: "Work" }],
    }),
  ).rejects.toThrow("explicit target");
  let { plan } = await propose();
  const firstContext = await tool("code60_get_context");
  const dispatch = {
    scope: firstContext.scope,
    requestId: "planned",
    cwd: join(root, "target"),
    workspaceMode: "direct",
    prompt: "Work only in the accepted target",
    planTaskId: required(plan.tasks[0]).id,
  };
  await expect(tool("code60_dispatch_agent", dispatch)).rejects.toThrow("Accept");
  expect(agents.specs).toHaveLength(1);
  const second = join(root, "second");
  await mkdir(second);
  plan = (await tool("code60_update_plan", {
    operation: "revise",
    planId: plan.id,
    revision: plan.revision,
    draft: {
      title: "Updated target",
      description: "",
      tasks: [
        {
          id: required(plan.tasks[0]).id,
          text: "Work in second",
          target: { cwd: second, workspaceMode: "direct" },
        },
      ],
    },
  })) as unknown as Plan;
  await expect(
    relay.planAction({ type: "accept", chatId: plan.chatId, planId: plan.id, revision: 1 }),
  ).rejects.toThrow("changed");
  await relay.planAction({
    type: "accept",
    chatId: plan.chatId,
    planId: plan.id,
    revision: plan.revision,
  });
  await vi.waitFor(() => expect(relay.snapshot().plans?.[0]?.state).toBe("running"));
  const context = await tool("code60_get_context");
  await expect(
    tool("code60_dispatch_agent", { ...dispatch, scope: context.scope }),
  ).rejects.toThrow("target or mode");
  await expect(
    tool("code60_dispatch_agent", {
      ...dispatch,
      scope: context.scope,
      cwd: second,
      workspaceMode: "worktree",
    }),
  ).rejects.toThrow("target or mode");
  const request = { ...dispatch, scope: context.scope, cwd: second };
  const worker = await tool("code60_dispatch_agent", request);
  expect(worker).toMatchObject({
    cwd: second,
    planId: plan.id,
    planTaskId: required(plan.tasks[0]).id,
  });
  const accepted = await relay.readPlan({ chatId: plan.chatId, planId: plan.id });
  expect(accepted.tasks[0]?.target).toMatchObject({ cwd: second, workspaceMode: "direct" });
  expect(accepted.tasks[0]?.workerIds).toEqual([worker.runId]);
  expect((await tool("code60_dispatch_agent", request)).runId).toBe(worker.runId);
  await expect(
    tool("code60_update_plan", {
      operation: "revise",
      planId: plan.id,
      revision: accepted.revision,
      draft: {
        title: "Illegal retarget",
        description: "",
        tasks: [{ text: "New", target: { cwd: root, workspaceMode: "direct" } }],
      },
    }),
  ).rejects.toThrow("Only draft");
  expect(agents.specs).toHaveLength(2);
});
it("keeps accepted dispatch idempotent when private plan association storage fails", async () => {
  agents.script = (_text, session) => (session.pid === 1000 ? "end_turn" : "hang");
  await connect();
  await relay.action({ type: "send", id: required(relay.snapshot().run).id, text: "Plan work" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const { plan } = await propose();
  await relay.planAction({
    type: "accept",
    chatId: plan.chatId,
    planId: plan.id,
    revision: plan.revision,
  });
  await vi.waitFor(() => expect(relay.snapshot().plans?.[0]?.state).toBe("running"));
  const path = join(
    root,
    "state",
    "code60",
    "relay",
    "documents",
    ".code60",
    "plans",
    `${plan.id}.json`,
  );
  const original = await readFile(path, "utf8");
  await writeFile(path, original.replace('"running"', '"paused"'));
  const { scope } = await tool("code60_get_context");
  const request = {
    scope,
    requestId: "accepted",
    cwd: join(root, "target"),
    workspaceMode: "direct",
    prompt: "work",
    planTaskId: required(plan.tasks[0]).id,
  };
  const first = await tool("code60_dispatch_agent", request);
  const second = await tool("code60_dispatch_agent", request);
  expect(first.runId).toBe(second.runId);
  expect(relay.snapshot().error).toContain("do not dispatch it again");
  await vi.waitFor(() => expect(agents.specs).toHaveLength(2));
  await writeFile(path, original);
});
it("reloads paused Relay plans without prompts or accepted task authority", async () => {
  await connect();
  await relay.action({ type: "send", id: required(relay.snapshot().run).id, text: "Propose work" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const { request, plan } = await propose();
  await relay.planAction({
    type: "accept",
    chatId: plan.chatId,
    planId: plan.id,
    revision: plan.revision,
  });
  await vi.waitFor(() => expect(relay.snapshot().plans?.[0]?.state).toBe("running"));
  await relay.action({ type: "restart", id: plan.chatId });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  expect(agents.sessions.at(-1)?.prompts).toEqual([]);
  expect((await tool("code60_get_context")).taskId).toBeNull();
  const saved = await relay.readPlan({ chatId: plan.chatId, planId: plan.id });
  expect(saved.state).toBe("paused");
  await expect(
    relay.planAction({
      type: "resume",
      chatId: plan.chatId,
      planId: plan.id,
      revision: saved.revision,
    }),
  ).rejects.toThrow("no live task");
  await relay.action({
    type: "send",
    id: required(relay.snapshot().run).id,
    text: "A new human request",
  });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  await expect(tool("code60_create_plan", request)).rejects.toThrow("no live task");
  await expect(
    relay.planAction({
      type: "resume",
      chatId: plan.chatId,
      planId: plan.id,
      revision: saved.revision,
    }),
  ).rejects.toThrow("no live task");
  expect(agents.specs).toHaveLength(2);
});
it("automatically connects idle without a database, prompt, native restore or worker authority", async () => {
  await connect();
  expect(agents.sessions[0]?.prompts).toEqual([]);
  expect(agents.restores).toEqual([]);
  expect(relay.snapshot().title).toBe("Relay");
  expect((await tool("code60_get_context")).scope).toBeNull();
  await expect(tool("code60_dispatch_agent", {})).rejects.toThrow("human request");
});
it("keeps one identity across restarts and injects shared bounded history exactly once after Send", async () => {
  await connect();
  const firstId = relay.snapshot().conversationId;
  const run = required(relay.snapshot().run);
  await relay.action({ type: "send", id: run.id, text: "Original request 😀" });
  await flush(20);
  await relay.shutdown();
  agents = new FakeAgents();
  relay = create();
  await connect();
  expect(relay.snapshot().conversationId).toBe(firstId);
  const history = required(relay.snapshot().history);
  expect(history.serialized).toContain("Original request 😀");
  expect(
    history.messages?.some(
      (message) => message.role === "human" && message.text === "Original request 😀",
    ),
  ).toBe(true);
  expect(history.characters).toBeLessThanOrEqual(64_000);
  expect(agents.sessions[0]?.prompts).toEqual([]);
  expect(agents.restores).toEqual([]);
  await relay.action({ type: "send", id: required(relay.snapshot().run).id, text: "New request" });
  await vi.waitFor(() => expect(agents.sessions[0]?.prompts).toHaveLength(1));
  expect(agents.sessions[0]?.prompts[0]).toContain(history.serialized);
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  await relay.action({
    type: "send",
    id: required(relay.snapshot().run).id,
    text: "Another request",
  });
  await vi.waitFor(() => expect(agents.sessions[0]?.prompts).toHaveLength(2));
  expect(agents.sessions[0]?.prompts[1]).not.toContain("Original request 😀");
});
it("dispatches to explicit unopened direct targets and enforces scope and ownership", async () => {
  await connect();
  await relay.action({
    type: "send",
    id: required(relay.snapshot().run).id,
    text: "Work in the target",
  });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const { scope } = await tool("code60_get_context");
  await expect(
    tool("code60_dispatch_agent", {
      scope,
      requestId: "missing-cwd",
      prompt: "task",
      workspaceMode: "direct",
    }),
  ).rejects.toThrow("Invalid Relay");
  const request = {
    scope,
    requestId: "one",
    cwd: join(root, "target"),
    workspaceMode: "direct",
    prompt: "task",
  };
  const first = await tool("code60_dispatch_agent", request);
  const repeated = await tool("code60_dispatch_agent", request);
  expect(first.runId).toBe(repeated.runId);
  expect(first).toMatchObject({ cwd: join(root, "target"), directEditing: true });
  await flush(20);
  await expect(tool("code60_stop_agent", { scope: "stale", runId: first.runId })).rejects.toThrow(
    "stale",
  );
  await expect(tool("code60_read_agent", { runId: "unowned" })).rejects.toThrow("does not own");
  await tool("code60_stop_agent", { scope, runId: first.runId });
});
it("exposes retry after a failed connection without looping or sending bootstrap prompts", async () => {
  agents.startError = new Error("Harness unavailable");
  await relay.sync("claude", DEFAULT_CONFIG);
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("failed"));
  expect(agents.specs).toHaveLength(1);
  expect(agents.sessions).toHaveLength(0);
  agents.startError = undefined;
  await relay.action({ type: "restart", id: required(relay.snapshot().conversationId) });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  expect(agents.specs).toHaveLength(2);
  expect(agents.sessions[0]?.prompts).toEqual([]);
});

it("keeps older tasks live and delivers results with their originating authority", async () => {
  agents.script = (_text, session) => (session.pid === 1000 ? "end_turn" : "hang");
  await connect();
  const id = required(relay.snapshot().run).id;
  await relay.action({ type: "send", id, text: "First task" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const firstContext = await tool("code60_get_context");
  const worker = await tool("code60_dispatch_agent", {
    scope: firstContext.scope,
    requestId: "first",
    cwd: join(root, "target"),
    workspaceMode: "direct",
    prompt: "Keep working",
  });
  await vi.waitFor(() => expect(agents.sessions[1]?.turnActive).toBe(true));
  await relay.action({ type: "send", id, text: "Second task" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const secondContext = await tool("code60_get_context");
  expect(secondContext.taskId).not.toBe(worker.taskId);
  expect(secondContext.scope).not.toBe(firstContext.scope);
  agents.sessions[1]?.endTurn("end_turn");
  await vi.waitFor(() => expect(agents.sessions[0]?.prompts).toHaveLength(3));
  const context = await tool("code60_get_context");
  expect(context.taskId).toBe(worker.taskId);
  expect(agents.sessions[0]?.prompts[2]).toContain(`originating task ${worker.taskId}`);
  await tool("code60_stop_agent", { scope: context.scope, runId: worker.runId });
});

it("qualifies a follow-up worker turn with the human task that sent it", async () => {
  agents.script = (_text, session) => (session.pid === 1000 ? "end_turn" : "hang");
  await connect();
  const id = required(relay.snapshot().run).id;
  await relay.action({ type: "send", id, text: "First task" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const first = await tool("code60_get_context");
  const worker = await tool("code60_dispatch_agent", {
    scope: first.scope,
    requestId: "worker",
    cwd: join(root, "target"),
    workspaceMode: "direct",
    prompt: "First turn",
  });
  await vi.waitFor(() => expect(agents.sessions[1]?.turnActive).toBe(true));
  agents.sessions[1]?.endTurn("end_turn");
  await vi.waitFor(() => expect(agents.sessions[0]?.prompts).toHaveLength(2));
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  await relay.action({ type: "send", id, text: "Second task with follow-up work" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const second = await tool("code60_get_context");
  expect(second.taskId).not.toBe(first.taskId);
  const followup = await tool("code60_send_agent", {
    scope: second.scope,
    runId: worker.runId,
    prompt: "Second turn",
  });
  expect(followup.taskId).toBe(second.taskId);
  await vi.waitFor(() => expect(agents.sessions[1]?.turnActive).toBe(true));
  agents.sessions[1]?.endTurn("end_turn");
  await vi.waitFor(() => expect(agents.sessions[0]?.prompts).toHaveLength(4));
  expect(agents.sessions[0]?.prompts[3]).toContain(`originating task ${second.taskId}`);
  expect((await tool("code60_get_context")).taskId).toBe(second.taskId);
});
it("does not pause automation when a scheduled result delivery finds an already drained inbox", async () => {
  await connect();
  await relay.action({ type: "send", id: required(relay.snapshot().run).id, text: "Start work" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const { scope } = await tool("code60_get_context");
  await tool("code60_dispatch_agent", {
    scope,
    requestId: "drained",
    cwd: join(root, "target"),
    workspaceMode: "direct",
    prompt: "Finish one turn",
  });
  await vi.waitFor(() => expect(agents.sessions[0]?.prompts).toHaveLength(2));
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  await new Promise<void>((resolve) => setTimeout(resolve, 150));
  expect(relay.snapshot().updates?.pending).toBe(0);
  expect(relay.snapshot().updates?.paused).toBe(false);
  expect(relay.snapshot().error).toBeNull();
});
it("refreshes verified providers without reconnecting and freezes each task's provider config", async () => {
  await connect();
  const id = required(relay.snapshot().run).id;
  await relay.action({ type: "send", id, text: "First task" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  await relay.sync("claude", DEFAULT_CONFIG);
  expect(agents.specs).toHaveLength(1);
  let context = await tool("code60_get_context");
  await expect(
    tool("code60_dispatch_agent", {
      scope: context.scope,
      requestId: "new-provider-old-task",
      cwd: join(root, "target"),
      workspaceMode: "direct",
      prompt: "task",
      provider: "codex",
    }),
  ).rejects.toThrow("Unavailable verified provider");
  await relay.action({ type: "send", id, text: "Use the updated provider configuration" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  context = await tool("code60_get_context");
  const worker = await tool("code60_dispatch_agent", {
    scope: context.scope,
    requestId: "new-provider-new-task",
    cwd: join(root, "target"),
    workspaceMode: "direct",
    prompt: "task",
    provider: "codex",
  });
  expect(worker.provider).toBe("codex");
  if (typeof worker.runId !== "string") throw new Error("Dispatch must return a run ID");
  const workerId = worker.runId;
  await vi.waitFor(() => expect(agents.sessions[1]?.turnActive).toBe(false));
  await relay.action({ type: "cancel", id });
  await relay.sync("claude", {
    ...DEFAULT_CONFIG,
    agents: { claude: required(DEFAULT_CONFIG.agents.claude) },
  });
  context = await tool("code60_get_context");
  await expect(
    tool("code60_send_agent", {
      scope: context.scope,
      runId: workerId,
      prompt: "Must not continue a disabled provider",
    }),
  ).rejects.toThrow("Unavailable verified provider");
  await expect(
    relay.workerAction({ type: "reply", id: workerId, text: "Must not continue" }),
  ).rejects.toThrow("Unavailable verified provider");
  expect(agents.sessions[1]?.prompts).toHaveLength(1);
});

it("stops old workers before retrying a fresh idle connection", async () => {
  agents.script = (_text, session) => (session.pid === 1000 ? "end_turn" : "hang");
  await connect();
  const id = required(relay.snapshot().run).id;
  await relay.action({ type: "send", id, text: "Start a worker" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const { scope } = await tool("code60_get_context");
  await tool("code60_dispatch_agent", {
    scope,
    requestId: "old-worker",
    cwd: join(root, "target"),
    workspaceMode: "direct",
    prompt: "Keep working",
  });
  await vi.waitFor(() => expect(agents.sessions[1]?.turnActive).toBe(true));
  await relay.action({ type: "restart", id });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  expect(agents.sessions[1]?.stops.length).toBeGreaterThan(0);
  expect(agents.sessions[2]?.prompts).toEqual([]);
  expect(relay.snapshot().workers).toEqual([]);
  expect((await tool("code60_get_context")).scope).toBeNull();
});

it("exposes target-qualified worker snapshots and human controls without project state", async () => {
  await connect();
  await relay.action({
    type: "send",
    id: required(relay.snapshot().run).id,
    text: "Start a worker",
  });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const { scope } = await tool("code60_get_context");
  const worker = await tool("code60_dispatch_agent", {
    scope,
    requestId: "human-controls",
    cwd: join(root, "target"),
    workspaceMode: "direct",
    prompt: "Worker task",
  });
  const id = worker.runId as string;
  await vi.waitFor(() => expect(relay.workerSnapshot().runs[0]?.view?.status).toBe("idle"));
  expect(relay.workerSnapshot().runs[0]?.relay).toMatchObject({
    cwd: join(root, "target"),
    workspaceMode: "direct",
    taskId: worker.taskId,
  });
  expect(relay.handlesWorkerAction({ type: "reply", id, text: "Human follow-up" })).toBe(true);
  await relay.workerAction({ type: "reply", id, text: "Human follow-up" });
  await vi.waitFor(() => expect(agents.sessions[1]?.prompts).toHaveLength(2));
  const events = await relay.workerAction({ type: "events", id });
  expect(events).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: "prompt", text: "Human follow-up" })]),
  );
  await expect(relay.workerAction({ type: "discard", id })).rejects.toThrow("project-local");
  await relay.workerAction({ type: "stop", id });
  expect(relay.workerSnapshot().liveIds).not.toContain(id);
});

it("pages through bounded opaque cursors without replacing first-Send history or granting authority", async () => {
  const store = await RelayStore.open(join(root, "state", "code60", "relay"));
  try {
    await store.append({
      id: randomUUID(),
      role: "human",
      at: new Date().toISOString(),
      text: "😀文".repeat(100_000),
    });
  } finally {
    await store.close();
  }
  await connect();
  const id = required(relay.snapshot().run).id;
  const initial = required(relay.snapshot().history);
  const cursor = required(initial.cursor);
  expect(cursor).toMatch(/^[a-f0-9-]{36}$/);
  await relay.action({ type: "history", id, before: cursor });
  expect(relay.snapshot().history?.cursor).not.toBe(cursor);
  expect(agents.sessions[0]?.prompts).toEqual([]);
  expect((await tool("code60_get_context")).scope).toBeNull();
  await expect(relay.action({ type: "history", id, before: randomUUID() })).rejects.toThrow(
    "expired",
  );
  await relay.action({ type: "send", id, text: "A new explicit request" });
  await vi.waitFor(() => expect(agents.sessions[0]?.prompts).toHaveLength(1));
  expect(agents.sessions[0]?.prompts[0]).toContain(initial.serialized);
});

it("saves thousands of streaming chunks without failing or cancelling the conversation", async () => {
  agents.script = (_text, session) => {
    for (let index = 0; index < 3000; index++)
      session.update({ type: "message", text: `chunk ${index} 😀\n` });
    return "end_turn";
  };
  await connect();
  await relay.action({ type: "send", id: required(relay.snapshot().run).id, text: "Stream" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  await relay.shutdown();
  const store = await RelayStore.open(join(root, "state", "code60", "relay"));
  try {
    const history = await store.history();
    expect(history.incomplete).toBe(false);
    expect(history.messages.at(-1)?.text).toBe(
      Array.from({ length: 3000 }, (_, index) => `chunk ${index} 😀\n`).join(""),
    );
  } finally {
    await store.close();
  }
  expect(relay.snapshot().error).toBeNull();
  expect(agents.sessions[0]?.cancels).toBe(0);
});

it("keeps Send and worker delivery operational after a journal failure and saves again after Retry", async () => {
  await connect();
  const append = vi.spyOn(RelayStore.prototype, "appendBatch");
  append.mockRejectedValueOnce(new Error("Transient write failure"));
  await relay.action({ type: "send", id: required(relay.snapshot().run).id, text: "First" });
  await vi.waitFor(() => expect(relay.snapshot().historySaving).toBe("unavailable"));
  expect(relay.snapshot().error).toBeNull();
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  await relay.action({
    type: "send",
    id: required(relay.snapshot().run).id,
    text: "Still chatting",
  });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const { scope } = await tool("code60_get_context");
  await tool("code60_dispatch_agent", {
    scope,
    requestId: "history-failure-worker",
    cwd: join(root, "target"),
    workspaceMode: "direct",
    prompt: "Worker remains operational",
  });
  await vi.waitFor(() => expect(agents.sessions[0]?.prompts.length).toBeGreaterThan(2));
  expect(append).toHaveBeenCalledTimes(1);
  await relay.action({ type: "restart", id: required(relay.snapshot().conversationId) });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  expect(relay.snapshot().historySaving).toBe("available");
  expect(relay.snapshot().history?.incomplete).toBe(true);
  expect(agents.sessions.at(-1)?.prompts).toEqual([]);
  await relay.action({ type: "send", id: required(relay.snapshot().run).id, text: "Second" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  await relay.action({ type: "restart", id: required(relay.snapshot().conversationId) });
  expect(relay.snapshot().history?.serialized).toContain("Second");
  expect(relay.snapshot().error).toBeNull();
});

it("preserves a damaged journal and rejects connection before launching an agent", async () => {
  const path = join(root, "state", "code60", "relay");
  const store = await RelayStore.open(path);
  await store.close();
  await appendFile(join(path, "history.frames"), "unfinished");
  await relay.sync("claude", DEFAULT_CONFIG);
  expect(relay.snapshot().error).toContain("damaged");
  expect(agents.specs).toHaveLength(0);
  expect(await readFile(join(path, "history.frames"), "utf8")).toBe("unfinished");
});

it("reads original excerpt sources through bounded opaque cursors without prompts or authority", async () => {
  const store = await RelayStore.open(join(root, "state", "code60", "relay"));
  const original = "  Begin\n" + "😀文\n".repeat(40_000) + "end\t\n";
  try {
    await store.append({
      id: randomUUID(),
      role: "assistant",
      at: new Date().toISOString(),
      text: original,
    });
  } finally {
    await store.close();
  }
  await connect();
  const conversationId = required(relay.snapshot().conversationId);
  for (let page = 0; page < 2; page++) {
    const message = required(relay.snapshot().history?.messages?.[0]);
    expect(message.partial).toBe(true);
    const source = required(message.source);
    await expect(relay.readMessage({ conversationId: randomUUID(), source })).rejects.toThrow(
      "expired",
    );
    await expect(
      relay.readMessage({ conversationId, source, cursor: randomUUID() }),
    ).rejects.toThrow("expired");
    const parts: string[] = [];
    let cursor: string | undefined;
    for (let count = 0; count < 100; count++) {
      const result = await relay.readMessage({
        conversationId,
        source,
        ...(cursor ? { cursor } : {}),
      });
      expect([...result.text].length).toBeLessThanOrEqual(16_000);
      parts.push(result.text);
      cursor = result.cursor ?? undefined;
      if (!cursor) break;
    }
    expect(cursor).toBeUndefined();
    expect(parts.join("")).toBe(original);
    expect(agents.sessions[0]?.prompts).toEqual([]);
    expect((await tool("code60_get_context")).scope).toBeNull();
    if (!page)
      await relay.action({
        type: "history",
        id: required(relay.snapshot().run).id,
        before: required(relay.snapshot().history?.cursor),
      });
  }
});

it("bounds concurrent source reads and expires old source cursors without execution", async () => {
  const store = await RelayStore.open(join(root, "state", "code60", "relay"));
  try {
    await store.append({
      id: randomUUID(),
      role: "assistant",
      at: new Date().toISOString(),
      text: "😀".repeat(100_000),
    });
  } finally {
    await store.close();
  }
  await connect();
  const request = {
    conversationId: required(relay.snapshot().conversationId),
    source: required(relay.snapshot().history?.messages?.[0]?.source),
  };
  const first = relay.readMessage(request);
  const second = relay.readMessage(request);
  await expect(relay.readMessage(request)).rejects.toThrow("busy");
  const [left, right] = await Promise.all([first, second]);
  expect(left.text).toBe(right.text);
  const old = required(left.cursor);
  const next = await relay.readMessage({ ...request, cursor: required(right.cursor) });
  await relay.readMessage({ ...request, cursor: required(next.cursor) });
  await expect(relay.readMessage({ ...request, cursor: old })).rejects.toThrow("expired");
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 5 * 60_000 + 1);
  try {
    await expect(relay.readMessage(request)).rejects.toThrow("expired");
  } finally {
    clock.mockRestore();
  }
  expect(agents.sessions[0]?.prompts).toEqual([]);
  await relay.shutdown(true);
  await expect(relay.readMessage(request)).rejects.toThrow("expired");
});

it.each(["stop all", "shutdown"])(
  "never starts a stale ACP connection after %s races preparation",
  async (action) => {
    let entered!: () => void;
    let release!: () => void;
    const admitted = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    relay = create(async () => {
      entered();
      await gate;
    });
    const connecting = relay.sync("claude", DEFAULT_CONFIG);
    await admitted;
    const stopping = action === "shutdown" ? relay.shutdown() : relay.stopAll();
    release();
    await Promise.all([connecting, stopping]);
    expect(agents.specs).toHaveLength(0);
    expect(relay.snapshot().run).toBeNull();
  },
);
