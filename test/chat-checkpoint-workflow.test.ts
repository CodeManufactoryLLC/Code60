import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { access, link, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, defaultDeps, TaskLoop } from "../src/core/index.js";
import { RelayService } from "../src/desktop/relay-service.js";
import { FakeAgents, FakeProcesses } from "./fakes.js";

// These complete multi-target journeys run real Git and durable journals, not only mocks.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

let root: string;
let agents: FakeAgents;
let relay: RelayService;
let deps: ReturnType<typeof defaultDeps>;
const confirm = vi.fn<(...args: string[]) => Promise<boolean>>();
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", `core.hooksPath=${join(root, "no-hooks")}`, ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "code60-chat-working-")));
  agents = new FakeAgents();
  confirm.mockReset().mockResolvedValue(true);
  deps = {
    ...defaultDeps(),
    agents,
    processes: new FakeProcesses(),
  };
  relay = new RelayService(deps, { XDG_STATE_HOME: join(root, "state") }, vi.fn(), { confirm });
});
afterEach(async () => {
  await relay.shutdown(true);
  await rm(root, { recursive: true, force: true });
});
function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error("Missing fixture");
  return value;
}
async function project(name: string) {
  const cwd = join(root, name);
  await mkdir(cwd);
  git(cwd, "init", "-q");
  git(cwd, "config", "core.autocrlf", "false");
  git(cwd, "config", "user.name", "Checkpoint fixture");
  git(cwd, "config", "user.email", "checkpoint@example.invalid");
  git(cwd, "config", "commit.gpgsign", "false");
  await writeFile(join(cwd, "file.txt"), "before\n");
  await writeFile(join(cwd, "unrelated.txt"), "initial\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "baseline");
  await writeFile(join(cwd, "unrelated.txt"), "staged change\n");
  git(cwd, "add", "unrelated.txt");
  await writeFile(join(cwd, "unrelated.txt"), "unstaged change\n");
  return {
    cwd,
    index: await readFile(join(cwd, ".git", "index")),
    head: git(cwd, "rev-parse", "HEAD"),
  };
}
/** Undo awaits connection preparation, but the replacement provider launch settles afterward. */
async function replacementSession(before: number) {
  await vi.waitFor(() => {
    expect(agents.sessions.length).toBeGreaterThan(before);
    expect(relay.snapshot().run?.status).toBe("idle");
  });
  expect(agents.sessions).toHaveLength(before + 1);
  return required(agents.sessions.at(-1));
}
async function connect() {
  await relay.sync("claude", DEFAULT_CONFIG);
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
}
async function tool(name: string, args: unknown = {}) {
  const server = agents.specs.findLast((spec) => spec.mcpServers?.length)?.mcpServers?.[0];
  if (!server || "type" in server) throw new Error("Missing gateway");
  const env = Object.fromEntries((server.env ?? []).map((entry) => [entry.name, entry.value]));
  const response = await fetch(required(env.CODE60_MCP_GATEWAY_URL), {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.CODE60_MCP_GATEWAY_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name, arguments: args }),
  });
  const result = (await response.json()) as { result?: Record<string, unknown>; error?: string };
  if (!response.ok) throw new Error(result.error);
  return required(result.result);
}
it.each(["plain", "git"] as const)(
  "snapshots %s direct workers before execution and warns that manual edits also rewind",
  async (mode) => {
    const target = mode === "git" ? await project("direct") : undefined;
    const cwd = target?.cwd ?? join(root, "direct");
    if (!target) {
      await mkdir(cwd);
      await writeFile(join(cwd, "file.txt"), "before\n");
      await writeFile(join(cwd, "unrelated.txt"), "manual before request\n");
    }
    await writeFile(join(cwd, "removed.txt"), "restore deletion\n");
    await writeFile(join(cwd, "old-name.txt"), "restore rename\n");
    const manualBefore = await readFile(join(cwd, "unrelated.txt"));
    agents.script = (_text, session) => {
      const spec = agents.specs.find((_, index) => agents.sessions[index] === session);
      if (spec?.cwd === cwd) {
        writeFileSync(join(cwd, "file.txt"), "direct result\n");
        writeFileSync(join(cwd, "added.bin"), Buffer.from([0, 255, 4]));
        unlinkSync(join(cwd, "removed.txt"));
        renameSync(join(cwd, "old-name.txt"), join(cwd, "new-name.txt"));
      }
      return "end_turn";
    };
    await connect();
    const id = required(relay.snapshot().run).id;
    await relay.action({ type: "send", id, text: "Edit this direct folder." });
    await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
    const { scope } = await tool("code60_get_context");
    const worker = await tool("code60_dispatch_agent", {
      scope,
      requestId: "direct",
      cwd,
      workspaceMode: "direct",
      prompt: "Edit files directly.",
    });
    expect(worker.checkpointWarning).toContain("manual edits");
    await vi.waitFor(async () =>
      expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("direct result\n"),
    );
    await writeFile(join(cwd, "unrelated.txt"), "manual edit after snapshot\n");
    const checkpointId = required(relay.snapshot().checkpoint).id;
    confirm.mockResolvedValueOnce(false);
    await relay.action({ type: "undo-request", id, checkpointId, replacesDraft: false });
    expect(await readFile(join(cwd, "unrelated.txt"), "utf8")).toBe("manual edit after snapshot\n");
    expect(confirm.mock.calls.at(-1)?.[1]).toContain("also rewind manual edits");
    const sessions = agents.sessions.length;
    expect(
      await relay.action({ type: "undo-request", id, checkpointId, replacesDraft: false }),
    ).toMatchObject({ type: "rewound", text: "Edit this direct folder." });
    expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("before\n");
    expect(await readFile(join(cwd, "unrelated.txt"))).toEqual(manualBefore);
    expect(await readFile(join(cwd, "removed.txt"), "utf8")).toBe("restore deletion\n");
    expect(await readFile(join(cwd, "old-name.txt"), "utf8")).toBe("restore rename\n");
    await expect(access(join(cwd, "added.bin"))).rejects.toThrow();
    await expect(access(join(cwd, "new-name.txt"))).rejects.toThrow();
    if (target) {
      expect(await readFile(join(cwd, ".git", "index"))).toEqual(target.index);
      expect(git(cwd, "rev-parse", "HEAD")).toBe(target.head);
    }
    expect((await replacementSession(sessions)).prompts).toEqual([]);
    expect(agents.sessions.slice(0, -1).every((session) => session.stops.length > 0)).toBe(true);
  },
);
it("refuses unsupported direct coverage before any worker process or editable prompt", async () => {
  const cwd = join(root, "linked");
  await mkdir(cwd);
  await writeFile(join(cwd, "file.txt"), "original");
  await link(join(cwd, "file.txt"), join(cwd, "hard-link.txt"));
  await connect();
  const id = required(relay.snapshot().run).id;
  await relay.action({ type: "send", id, text: "Start direct editing." });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const { scope } = await tool("code60_get_context");
  const starts = agents.sessions.length;
  await expect(
    tool("code60_dispatch_agent", {
      scope,
      requestId: "unsupported",
      cwd,
      workspaceMode: "direct",
      prompt: "Edit it.",
    }),
  ).rejects.toThrow("non-linked files");
  expect(agents.sessions).toHaveLength(starts);
  expect(relay.workerSnapshot().runs).toHaveLength(0);
  expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("original");
});
it("enrolls idle direct-worker chat follow-ups in the new request before replying", async () => {
  const cwd = join(root, "followup");
  await mkdir(cwd);
  await writeFile(join(cwd, "file.txt"), "original");
  agents.script = (_text, session) => {
    const spec = agents.specs.find((_, index) => agents.sessions[index] === session);
    if (spec?.cwd === cwd)
      writeFileSync(join(cwd, "file.txt"), session.prompts.length === 1 ? "first" : "followup");
    return "end_turn";
  };
  await connect();
  const id = required(relay.snapshot().run).id;
  await relay.action({ type: "send", id, text: "First request" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const { scope } = await tool("code60_get_context");
  const worker = await tool("code60_dispatch_agent", {
    scope,
    requestId: "followup",
    cwd,
    workspaceMode: "direct",
    prompt: "Initial edit",
  });
  await vi.waitFor(() => expect(relay.workerSnapshot().runs[0]?.view?.status).toBe("idle"));
  expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("first");
  // Drain the expected automatic result before asserting that a rejected reply sends nothing.
  await vi.waitFor(() =>
    expect(agents.sessions[0]?.prompts.some((text) => text.includes(String(worker.runId)))).toBe(
      true,
    ),
  );
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  await relay.action({ type: "send", id, text: "Second request" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  expect(relay.snapshot().checkpoint).toBeDefined();
  await link(join(cwd, "file.txt"), join(cwd, "hard-link"));
  const prompts = agents.sessions.map((session) => [...session.prompts]);
  await expect(
    relay.workerAction({ type: "reply", id: String(worker.runId), text: "Blocked" }),
  ).rejects.toThrow("non-linked");
  expect(agents.sessions.map((session) => session.prompts)).toEqual(prompts);
  await rm(join(cwd, "hard-link"));
  await relay.workerAction({ type: "reply", id: String(worker.runId), text: "Follow-up edit" });
  await vi.waitFor(async () =>
    expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("followup"),
  );
  await relay.action({
    type: "undo-request",
    id,
    checkpointId: required(relay.snapshot().checkpoint).id,
    replacesDraft: false,
  });
  expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("first");
});
it("records an older worker's later integration after the new human boundary and retires discarded context", async () => {
  const target = await project("older-worker");
  agents.script = (text, session) => {
    const spec = agents.specs.find((_, index) => agents.sessions[index] === session);
    if (spec?.cwd.includes("worktrees")) {
      writeFileSync(join(spec.cwd, "file.txt"), "delayed result\n");
      return "hang";
    }
    return text.includes("unused") ? "hang" : "end_turn";
  };
  await connect();
  const id = required(relay.snapshot().run).id;
  await relay.action({ type: "send", id, text: "SURVIVING_FIRST_REQUEST" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const { scope } = await tool("code60_get_context");
  await tool("code60_dispatch_agent", {
    scope,
    requestId: "delayed",
    cwd: target.cwd,
    workspaceMode: "worktree",
    prompt: "Work across the next message",
  });
  await vi.waitFor(() => expect(agents.sessions.at(-1)?.turnActive).toBe(true));
  const worker = required(agents.sessions.at(-1));
  expect(await readFile(join(target.cwd, "file.txt"), "utf8")).toBe("before\n");
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  await relay.action({ type: "send", id, text: "DISCARDED_LATER_REQUEST" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  worker.endTurn("end_turn");
  await vi.waitFor(
    async () =>
      expect(await readFile(join(target.cwd, "file.txt"), "utf8")).toBe("delayed result\n"),
    { timeout: 10_000 },
  );
  const chat = relay.snapshot();
  const timeline = await relay.reviewRequest({
    type: "timeline",
    conversationId: required(chat.conversationId),
    generation: required(chat.generation),
  });
  if (timeline.type !== "timeline") throw new Error("Missing timeline");
  expect(timeline.entries[0]?.summary?.revisions.at(-1)?.request).toEqual({
    chatId: id,
    turn: required(chat.checkpoint).turn,
  });
  const sessions = agents.sessions.length;
  await relay.action({
    type: "undo-request",
    id,
    checkpointId: required(relay.snapshot().checkpoint).id,
    replacesDraft: false,
  });
  expect(await readFile(join(target.cwd, "file.txt"), "utf8")).toBe("before\n");
  expect(await readFile(join(target.cwd, ".git", "index"))).toEqual(target.index);
  expect(worker.stops.length).toBeGreaterThan(0);
  const fresh = await replacementSession(sessions);
  expect(fresh.prompts).toEqual([]);
  await relay.action({
    type: "send",
    id: required(relay.snapshot().run).id,
    text: "Continue surviving history",
  });
  await vi.waitFor(() => expect(fresh.prompts).toHaveLength(1));
  expect(fresh.prompts[0]).toContain("SURVIVING_FIRST_REQUEST");
  expect(fresh.prompts[0]).not.toContain("DISCARDED_LATER_REQUEST");
});
it("automatically changes two real checkouts and rewinds both without Apply, index changes or resending", async () => {
  const targets = await Promise.all([project("a"), project("b")]);
  agents.script = (text, session) => {
    const spec = agents.specs.find((_, index) => agents.sessions[index] === session);
    if (spec?.cwd.includes("worktrees"))
      writeFileSync(join(spec.cwd, "file.txt"), "working edit\n");
    return text.includes("unused hang") ? "hang" : "end_turn";
  };
  await connect();
  const id = required(relay.snapshot().run).id;
  await relay.action({ type: "send", id, text: "Update both addressed folders." });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const { scope } = await tool("code60_get_context");
  for (const [index, target] of targets.entries())
    await tool("code60_dispatch_agent", {
      scope,
      requestId: `target-${index}`,
      cwd: target.cwd,
      workspaceMode: "worktree",
      prompt: "Make a working edit.",
      label: `Worker ${index + 1}`,
    });
  await vi.waitFor(
    async () => {
      for (const target of targets)
        expect(await readFile(join(target.cwd, "file.txt"), "utf8")).toBe("working edit\n");
    },
    // Windows CI needed 16 s for one target's full journey; two integrate serially.
    { timeout: 20_000 },
  );
  const checkpointId = required(relay.snapshot().checkpoint).id;
  confirm.mockResolvedValueOnce(false);
  expect(
    await relay.action({ type: "undo-request", id, checkpointId, replacesDraft: true }),
  ).toBeUndefined();
  for (const target of targets)
    expect(await readFile(join(target.cwd, "file.txt"), "utf8")).toBe("working edit\n");
  const sessions = agents.sessions.length;
  expect(
    await relay.action({ type: "undo-request", id, checkpointId, replacesDraft: true }),
  ).toMatchObject({ type: "rewound", text: "Update both addressed folders." });
  for (const target of targets) {
    expect(await readFile(join(target.cwd, "file.txt"), "utf8")).toBe("before\n");
    expect(await readFile(join(target.cwd, "unrelated.txt"), "utf8")).toBe("unstaged change\n");
    expect(await readFile(join(target.cwd, ".git", "index"))).toEqual(target.index);
    expect(git(target.cwd, "rev-parse", "HEAD")).toBe(target.head);
  }
  const fresh = await replacementSession(sessions);
  expect(fresh.prompts).toHaveLength(0);
  expect(relay.snapshot().workers).toEqual([]);
  expect(agents.sessions.slice(0, -1).every((session) => session.stops.length > 0)).toBe(true);
}, 60_000); // Two serial Windows integrations can exceed the file's 30 s default.
// A passing single-target sibling journey took 16 s on Windows CI.
it("binds a capture delayed across Send to the checkpoint preceding its actual checkout write", async () => {
  const target = await project("delayed-capture");
  agents.script = (_text, session) => {
    const spec = agents.specs.find((_, index) => agents.sessions[index] === session);
    if (spec?.cwd.includes("worktrees"))
      writeFileSync(join(spec.cwd, "file.txt"), "captured result\n");
    return "end_turn";
  };
  const snapshot = required(deps.git.reviewSnapshot).bind(deps.git);
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const delayed = vi.spyOn(deps.git, "reviewSnapshot").mockImplementationOnce(async (...args) => {
    entered();
    await gate;
    return snapshot(...args);
  });
  try {
    await connect();
    const id = required(relay.snapshot().run).id;
    await relay.action({ type: "send", id, text: "First" });
    await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
    const { scope } = await tool("code60_get_context");
    await tool("code60_dispatch_agent", {
      scope,
      requestId: "delayed-capture",
      cwd: target.cwd,
      workspaceMode: "worktree",
      prompt: "Edit",
    });
    await ready;
    expect(await readFile(join(target.cwd, "file.txt"), "utf8")).toBe("before\n");
    await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
    await relay.action({ type: "send", id, text: "Request while capture is pending" });
    const checkpoint = required(relay.snapshot().checkpoint);
    release();
    await vi.waitFor(
      async () =>
        expect(await readFile(join(target.cwd, "file.txt"), "utf8")).toBe("captured result\n"),
      { timeout: 20_000 },
    );
    const chat = relay.snapshot();
    const timeline = await relay.reviewRequest({
      type: "timeline",
      conversationId: required(chat.conversationId),
      generation: required(chat.generation),
    });
    if (timeline.type !== "timeline") throw new Error("Missing timeline");
    expect(timeline.entries[0]?.summary?.revisions.at(-1)?.request).toEqual({
      chatId: id,
      turn: checkpoint.turn,
    });
    await relay.action({
      type: "undo-request",
      id,
      checkpointId: checkpoint.id,
      replacesDraft: false,
    });
    expect(await readFile(join(target.cwd, "file.txt"), "utf8")).toBe("before\n");
    expect(await readFile(join(target.cwd, ".git", "index"))).toEqual(target.index);
  } finally {
    release();
    delayed.mockRestore();
  }
}, 60_000);
it("resumes an interrupted Undo using Relay's conversation identity without a live provider", async () => {
  const cwd = join(root, "interrupted-direct");
  await mkdir(cwd);
  await writeFile(join(cwd, "file.txt"), "before");
  agents.script = (_text, session) => {
    const spec = agents.specs.find((_, index) => agents.sessions[index] === session);
    if (spec?.cwd === cwd) writeFileSync(join(cwd, "file.txt"), "after");
    return "end_turn";
  };
  await connect();
  const id = required(relay.snapshot().run).id;
  await relay.action({ type: "send", id, text: "A recoverable direct edit" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const { scope } = await tool("code60_get_context");
  await tool("code60_dispatch_agent", {
    scope,
    requestId: "interrupted",
    cwd,
    workspaceMode: "direct",
    prompt: "Edit",
  });
  await vi.waitFor(async () => expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("after"));
  const checkpointId = required(relay.snapshot().checkpoint).id;
  const interrupted = vi
    .spyOn(TaskLoop.prototype, "execute")
    .mockRejectedValueOnce(new Error("Interrupted Undo"));
  try {
    await expect(
      relay.action({ type: "undo-request", id, checkpointId, replacesDraft: false }),
    ).rejects.toThrow("Interrupted Undo");
  } finally {
    interrupted.mockRestore();
  }
  const stopped = relay.snapshot();
  expect(stopped.run).toBeNull();
  expect(stopped.checkpoint?.phase).toBe("undoing");
  expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("after");
  const sessions = agents.sessions.length;
  expect(
    await relay.action({
      type: "undo-request",
      id: required(stopped.conversationId),
      checkpointId,
      replacesDraft: false,
    }),
  ).toMatchObject({ type: "rewound", text: "A recoverable direct edit" });
  expect(await readFile(join(cwd, "file.txt"), "utf8")).toBe("before");
  expect((await replacementSession(sessions)).prompts).toEqual([]);
});
it("returns exact saved-code references with a rewound correction without resending", async () => {
  const target = await project("code-reference");
  agents.script = (_text, session) => {
    const spec = agents.specs.find((_, index) => agents.sessions[index] === session);
    if (spec?.cwd.includes("worktrees"))
      writeFileSync(join(spec.cwd, "file.txt"), "working edit\n");
    return "end_turn";
  };
  await connect();
  const id = required(relay.snapshot().run).id;
  await relay.action({ type: "send", id, text: "Original change" });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const { scope } = await tool("code60_get_context");
  await tool("code60_dispatch_agent", {
    scope,
    requestId: "code-reference",
    cwd: target.cwd,
    workspaceMode: "worktree",
    prompt: "Edit",
  });
  await vi.waitFor(
    async () => expect(await readFile(join(target.cwd, "file.txt"), "utf8")).toBe("working edit\n"),
    { timeout: 10_000 },
  );
  const chat = relay.snapshot();
  const address = {
    conversationId: required(chat.conversationId),
    generation: required(chat.generation),
  };
  const timeline = await relay.reviewRequest({ type: "timeline", ...address });
  if (timeline.type !== "timeline") throw new Error("Missing timeline");
  const entry = required(timeline.entries[0]).entry;
  const read = await relay.reviewRequest({
    type: "read",
    ...address,
    targetId: entry.targetId,
    reviewId: entry.id,
    requestId: randomUUID(),
  });
  if (read.type !== "review") throw new Error("Missing review");
  const revision = required(read.review.revisions.at(-1));
  const reference = {
    reviewId: entry.id,
    revisionId: revision.id,
    fileKey: required(revision.files[0]).key,
    side: "modified" as const,
    start: 1,
    end: 1,
  };
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  await relay.action({
    type: "send",
    id,
    text: "Correct this exact saved line",
    references: [reference],
  });
  await vi.waitFor(() => expect(relay.snapshot().run?.status).toBe("idle"));
  const sent = agents.sessions
    .flatMap((session) => session.prompts)
    .find((prompt) => prompt.includes("Correct this exact saved line"));
  expect(sent).toContain("working edit");
  expect(sent).toContain("modified lines 1-1");
  const sessions = agents.sessions.length;
  const result = await relay.action({
    type: "undo-request",
    id,
    checkpointId: required(relay.snapshot().checkpoint).id,
    replacesDraft: false,
  });
  expect(result).toMatchObject({ text: "Correct this exact saved line", references: [reference] });
  expect((await replacementSession(sessions)).prompts).toEqual([]);
  expect(await readFile(join(target.cwd, "file.txt"), "utf8")).toBe("working edit\n");
  expect(await readFile(join(target.cwd, ".git", "index"))).toEqual(target.index);
});
