import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApplicationAgents } from "../src/application/application-agents.js";
import type { CustomAgent } from "../src/bridge/index.js";
import { DEFAULT_CONFIG, defaultDeps } from "../src/core/index.js";
import { FakeAgents, FakeGit, FakeProcesses } from "./fakes.js";

// Each owner persists private Relay-style storage through the native ACL helper on Windows.

let root: string;
let agents: FakeAgents;
let host: ApplicationAgents;
let hosts: ApplicationAgents[];
const config = { ...DEFAULT_CONFIG, agents: { claude: DEFAULT_CONFIG.agents.claude! } };
const confirm = vi.fn(async () => true);
function create() {
  const git = new FakeGit();
  git.repoInfo = async () => {
    throw new Error("not Git");
  };
  const result = new ApplicationAgents(
    { ...defaultDeps(), agents, git, processes: new FakeProcesses() },
    { XDG_STATE_HOME: root },
    vi.fn(),
    { confirm },
    undefined,
  );
  hosts.push(result);
  return result;
}
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "code60-custom-runtime-")));
  agents = new FakeAgents();
  hosts = [];
  confirm.mockResolvedValue(true);
  host = create();
  await host.sync("claude", config);
});
afterEach(async () => {
  await Promise.allSettled(hosts.map((h) => h.shutdown(true)));
  await rm(root, { recursive: true, force: true });
});
async function define(name: string, instructions = `Only ${name}`): Promise<CustomAgent> {
  const { agent } = await host.manage({ type: "create", name, instructions });
  if (!agent) throw new Error("Missing agent");
  return agent;
}
async function open(agent: CustomAgent) {
  const result = await host.manage({ type: "open", id: agent.id });
  if (!result.conversationId) throw new Error("Missing conversation");
  await vi.waitFor(() => expect(host.snapshot().run?.status).toBe("idle"));
  return result.conversationId;
}
it("connects lazily and freezes distinct instructions, targets and histories across selection", async () => {
  const relayId = host.snapshot().run!.id;
  const a = await define("A $&"),
    b = await define("B");
  expect(agents.sessions).toHaveLength(1);
  const aId = await open(a);
  await host.action({ type: "send", id: aId, text: "A request" });
  await vi.waitFor(() => expect(agents.sessions[1]?.prompts).toHaveLength(1));
  expect(agents.sessions[1]?.prompts[0]).toContain("Only A");
  expect(agents.sessions[1]?.prompts[0]).toContain("You are A $&,");
  expect(agents.sessions[1]?.prompts[0]).not.toContain("Only B");
  const aScope = {
    kind: "conversation" as const,
    conversationId: host.snapshot().conversationId!,
    generation: host.snapshot().generation!,
  };
  const bId = await open(b);
  await host.action({ type: "send", id: bId, text: "B request" });
  await vi.waitFor(() => expect(agents.sessions[2]?.prompts).toHaveLength(1));
  expect(agents.sessions[2]?.prompts[0]).toContain("Only B");
  expect(agents.sessions[2]?.prompts[0]).not.toContain("A request");
  expect(host.fileRoot(aScope).cwd).toContain(a.id);
  await host.action({ type: "select", id: aId });
  expect(host.snapshot().customAgentId).toBe(a.id);
  await host.action({ type: "select", id: relayId });
  expect(host.snapshot().customAgentId).toBeUndefined();
  expect(host.snapshots(true)).toHaveLength(3);
  expect(JSON.stringify(host.snapshots(true))).not.toContain("Only A");
  await host.stopAll();
  expect(agents.sessions.every((s) => s.stops.length > 0)).toBe(true);
});
it("refreshes provider context on edit, retains history and rejects stale identities", async () => {
  const a = await define("A");
  const id = await open(a);
  const scope = {
    kind: "conversation" as const,
    conversationId: host.snapshot().conversationId!,
    generation: host.snapshot().generation!,
  };
  await host.action({ type: "send", id, text: "Remember this request" });
  await vi.waitFor(() => expect(host.snapshot().run?.status).toBe("idle"));
  await host.manage({
    type: "edit",
    id: a.id,
    revision: a.revision,
    name: "Renamed",
    instructions: "New instructions",
  });
  expect(() => host.fileRoot(scope)).toThrow();
  await expect(
    host.manage({ type: "edit", id: a.id, revision: 1, name: "Stale", instructions: "x" }),
  ).rejects.toThrow("changed");
  const nextId = await open(a);
  expect(nextId).not.toBe(id);
  expect(agents.sessions[2]?.prompts).toHaveLength(0);
  await host.action({ type: "send", id: nextId, text: "Continue explicitly" });
  await vi.waitFor(() => expect(agents.sessions[2]?.prompts).toHaveLength(1));
  expect(agents.sessions[2]?.prompts[0]).toContain("New instructions");
  expect(agents.sessions[2]?.prompts[0]).toContain("Remember this request");
  expect(agents.sessions[2]?.prompts[0]).not.toContain("Only A");
});
it("archives only its owner after confirmation, restores evidence without resuming, and reopens lazily after restart", async () => {
  const a = await define("A"),
    b = await define("B");
  await open(a);
  await open(b);
  confirm.mockResolvedValueOnce(false);
  await host.manage({ type: "archive", id: a.id, revision: 1 });
  expect(agents.sessions[1]?.stops).toHaveLength(0);
  await host.manage({ type: "archive", id: a.id, revision: 1 });
  expect(agents.sessions[1]?.stops.length).toBeGreaterThan(0);
  expect(agents.sessions[2]?.stops).toHaveLength(0);
  await expect(host.manage({ type: "open", id: a.id })).rejects.toThrow("Restore");
  await host.manage({ type: "restore", id: a.id, revision: 2 });
  expect(agents.sessions).toHaveLength(3);
  const state = await readFile(join(root, "code60/custom-agents", a.id, "state.json"));
  await host.shutdown();
  host = create();
  await host.sync("claude", config);
  expect(host.snapshot().error).toBeNull();
  await vi.waitFor(() => expect(agents.sessions).toHaveLength(4));
  expect(host.summaries()).toHaveLength(2);
  expect(await readFile(join(root, "code60/custom-agents", a.id, "state.json"))).toEqual(state);
  await open(a);
  expect(agents.sessions[4]?.prompts).toHaveLength(0);
});
it("refuses instruction edits during a running turn and retires all owners on provider removal", async () => {
  const a = await define("A");
  const id = await open(a);
  agents.script = () => "hang";
  // Existing fake sessions hold their original script, so create a hanging session explicitly.
  await host.manage({ type: "archive", id: a.id, revision: 1 });
  await host.manage({ type: "restore", id: a.id, revision: 2 });
  const current = await open(a);
  await host.action({ type: "send", id: current, text: "Long task" });
  await vi.waitFor(() => expect(host.snapshot().run?.status).toBe("running"));
  await expect(
    host.manage({ type: "edit", id: a.id, revision: 3, name: "A", instructions: "changed" }),
  ).rejects.toThrow("Stop");
  expect(() => host.action({ type: "select", id })).toThrow();
  await host.sync(undefined, config);
  expect(agents.sessions.every((s) => s.stops.length > 0)).toBe(true);
});

async function tool(
  index: number,
  name: string,
  args: unknown = {},
): Promise<Record<string, unknown>> {
  const server = agents.specs[index]?.mcpServers?.find((s) => s.name === "code60");
  if (!server || "type" in server) throw new Error("Missing gateway");
  const env = Object.fromEntries((server.env ?? []).map(({ name, value }) => [name, value]));
  const url = env.CODE60_MCP_GATEWAY_URL;
  if (!url) throw new Error("Missing gateway URL");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.CODE60_MCP_GATEWAY_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name, arguments: args }),
  });
  const body = (await response.json()) as { error?: string; result: Record<string, unknown> };
  if (!response.ok) throw new Error(body.error);
  return body.result;
}
it("routes plans, worker transcripts, reviews and Undo to their owner while another agent is selected", async () => {
  const target = join(root, "target");
  await mkdir(target);
  const a = await define("A"),
    b = await define("B");
  const aId = await open(a);
  await host.action({ type: "send", id: aId, text: "Propose work" });
  await vi.waitFor(() => expect(host.snapshot().run?.status).toBe("idle"));
  const aChat = host.snapshot(true);
  const plan = (await tool(1, "code60_create_plan", {
    requestId: "plan-a",
    title: "A plan",
    description: "",
    tasks: [{ text: "Inspect", target: { cwd: target, workspaceMode: "direct" } }],
  })) as unknown as import("../src/bridge/index.js").Plan;
  const aContext = await tool(1, "code60_get_context");
  const dispatch = {
    scope: aContext.scope,
    requestId: "worker-a",
    cwd: target,
    workspaceMode: "direct",
    prompt: "Inspect target",
    planTaskId: plan.tasks[0]!.id,
  };
  await expect(tool(1, "code60_dispatch_agent", dispatch)).rejects.toThrow("Accept");
  await open(b);
  expect((await host.readPlan({ chatId: plan.chatId, planId: plan.id })).title).toBe("A plan");
  await host.planAction({
    type: "accept",
    chatId: plan.chatId,
    planId: plan.id,
    revision: plan.revision,
  });
  await vi.waitFor(() =>
    expect(host.owner(aChat.conversationId!)!.snapshot().plans?.[0]?.state).toBe("running"),
  );
  const context = await tool(1, "code60_get_context");
  const worker = await tool(1, "code60_dispatch_agent", { ...dispatch, scope: context.scope });
  expect(host.snapshot().customAgentId).toBe(b.id);
  expect(host.handlesWorkerAction({ type: "stop", id: worker.runId as string })).toBe(true);
  await expect(tool(2, "code60_read_agent", { runId: worker.runId })).rejects.toThrow();
  const review = await host.reviewRequest({
    type: "list",
    conversationId: aChat.conversationId!,
    generation: aChat.generation!,
  });
  expect(review.type).toBe("list");
  const checkpointId = host.owner(aChat.conversationId!)!.snapshot().checkpoint!.id;
  const result = await host.action({
    type: "undo-request",
    id: aId,
    checkpointId,
    replacesDraft: false,
  });
  expect(result).toMatchObject({ type: "rewound", text: "Propose work" });
  expect(host.snapshot().customAgentId).toBe(b.id);
  expect(agents.sessions[2]?.stops).toHaveLength(0);
  expect(host.workerSnapshot().runs).toHaveLength(0);
});

it("cancels a queued lazy Open when Stop all intervenes, without starting a new provider", async () => {
  const a = await define("A");
  await vi.waitFor(() => expect(host.snapshot().run?.status).toBe("idle"));
  const stopped = expect(host.manage({ type: "open", id: a.id })).rejects.toThrow("cancelled");
  await host.stopAll();
  await stopped;
  expect(agents.sessions).toHaveLength(1);
  await open(a);
  expect(agents.sessions).toHaveLength(2);
  expect(agents.sessions[1]?.prompts).toHaveLength(0);
});

it("settles an in-flight catalog open on shutdown and releases its exclusive writer", async () => {
  await host.shutdown();
  const count = agents.sessions.length;
  const closing = create();
  const syncing = closing.sync("claude", config);
  await closing.shutdown();
  await syncing;
  expect(agents.sessions).toHaveLength(count);
  host = create();
  await host.sync("claude", config);
  await vi.waitFor(() => expect(agents.sessions).toHaveLength(count + 1));
  expect(host.error).toBeUndefined();
});

it("does not connect after Stop all interrupts initial catalog loading", async () => {
  await host.shutdown();
  const count = agents.sessions.length;
  host = create();
  const syncing = host.sync("claude", config);
  await host.stopAll();
  await syncing;
  expect(agents.sessions).toHaveLength(count);
  // A subsequent explicit human Open can still use the verified provider.
  await open(await define("After Stop all"));
  expect(agents.sessions).toHaveLength(count + 1);
  expect(agents.sessions.at(-1)?.prompts).toEqual([]);
});

it("allows graceful shutdown and force escalation to release the catalog together", async () => {
  await open(await define("A"));
  await Promise.all([host.shutdown(), host.shutdown(true)]);
  host = create();
  await host.sync("claude", config);
  expect(host.error).toBeUndefined();
  expect(host.summaries()).toHaveLength(1);
});

it.each(["corrupt-state", "missing-workspace"])(
  "rejects an unidentified Open after %s, preserves selection and evidence, and permits explicit retry",
  async (failure) => {
    const agent = await define("Recovery Agent");
    await open(agent);
    const directory = join(root, "code60/custom-agents", agent.id);
    const state = join(directory, "state.json");
    const workspace = join(directory, "workspace");
    const saved = await readFile(state);
    await host.shutdown();
    if (failure === "corrupt-state") await writeFile(state, "{bad");
    else await rename(workspace, `${workspace}.preserved`);
    host = create();
    await host.sync("claude", config);
    await vi.waitFor(() => expect(host.snapshot().run?.status).toBe("idle"));
    const selected = host.snapshot().conversationId;
    const count = agents.sessions.length;
    await expect(host.manage({ type: "open", id: agent.id })).rejects.toThrow();
    expect(host.snapshot().conversationId).toBe(selected);
    expect(host.snapshot().customAgentId).toBeUndefined();
    expect(host.summaries()).toContainEqual({
      id: agent.id,
      name: agent.name,
      archived: false,
      revision: 1,
    });
    expect(agents.sessions).toHaveLength(count);
    expect(await readFile(state)).toEqual(
      failure === "corrupt-state" ? Buffer.from("{bad") : saved,
    );
    // Fixture-only explicit storage recovery, never an application repair operation.
    if (failure === "corrupt-state") await writeFile(state, saved);
    else await rename(`${workspace}.preserved`, workspace);
    await open(agent);
    expect(host.snapshot().customAgentId).toBe(agent.id);
    expect(agents.sessions.at(-1)?.prompts).toEqual([]);
  },
);
