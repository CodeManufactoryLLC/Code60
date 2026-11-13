import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assembleOperatingContract,
  BUILTIN_COMMANDS,
  COMMAND_LIMIT,
  type Command,
  DEFAULT_PROMPT_TEMPLATES,
  type DetailFrame,
  type DetailRequest,
  type Plan,
  type PollSettingsPatch,
  type ProjectRequestIdentity,
  type PromptTemplates,
  type RunConfiguration,
} from "../src/bridge/index.js";
import {
  type CoreDeps,
  DEFAULT_CONFIG,
  defaultDeps,
  loadConfig,
  openWorkspace,
} from "../src/core/index.js";
import { ChatStore } from "../src/desktop/chat-store.js";
import { DesktopController } from "../src/desktop/controller.js";
import type {
  ChatSession,
  ConversationCoordinator,
} from "../src/desktop/conversation-coordinator.js";
import type { DesktopPreferences } from "../src/desktop/preferences.js";
import type { ProjectDatabase } from "../src/desktop/projects.js";
import type { ReviewStore } from "../src/desktop/reviews.js";
import type { Git, TaskGit } from "../src/git/index.js";
import { FakeAgents, FakeGit, FakeProcesses } from "./fakes.js";
import { verifiedAgents } from "./fixtures/verified-agents.js";

let directory: string;
let controller: DesktopController;
let agents: FakeAgents;
let git: FakeGit;
let confirm: ReturnType<typeof vi.fn<(title: string, detail: string) => Promise<boolean>>>;
const request = { agents: ["claude"], allow: [], allowAll: false };
let tick = 0;
let stored: string | undefined;
let preferencesFail = false;
let orchestrationProvider: string | null = null;
let listGate: (() => Promise<void>) | undefined;
const databases = new Map<
  string,
  {
    entries: Map<string, string>;
    configurations: RunConfiguration[];
    prompts: Partial<PromptTemplates>;
    commands: Command[];
    failWrites: boolean;
  }
>();
const openDatabase = vi.fn((path: string, create: boolean): ProjectDatabase => {
  let data = databases.get(path);
  if (data === undefined) {
    if (!create) throw new Error(`Database not found: ${path}`);
    data = { entries: new Map(), configurations: [], prompts: {}, commands: [], failWrites: false };
    databases.set(path, data);
  }
  const shared = data;
  let open = true;
  return {
    path,
    list: () => {
      if (!open) throw new Error("closed");
      return [...shared.entries]
        .map(([project, openedAt]) => ({ path: project, openedAt }))
        .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
    },
    record: (project, openedAt) => {
      if (!open) throw new Error("closed");
      if (shared.failWrites) throw new Error("disk is full");
      shared.entries.set(project, openedAt);
    },
    remove: (project) => {
      shared.entries.delete(project);
    },
    clear: () => {
      shared.entries.clear();
    },
    configurations: () => structuredClone(shared.configurations),
    commands: () => structuredClone(shared.commands).sort((a, b) => a.name.localeCompare(b.name)),
    command: (name) =>
      structuredClone(
        shared.commands.find((entry) => entry.name.toLowerCase() === name.toLowerCase()),
      ),
    saveCommand: (entry) => {
      if (shared.failWrites) throw new Error("disk is full");
      if (shared.commands.some((item) => item.id !== entry.id && item.name === entry.name))
        throw new Error("A command with that name already exists");
      if (
        !shared.commands.some((item) => item.id === entry.id) &&
        shared.commands.length >= COMMAND_LIMIT
      )
        throw new Error(`You can save at most ${COMMAND_LIMIT} commands`);
      shared.commands = [
        ...shared.commands.filter((item) => item.id !== entry.id),
        structuredClone(entry),
      ];
    },
    deleteCommand: (id) => {
      shared.commands = shared.commands.filter((item) => item.id !== id);
    },
    saveConfiguration: (entry) => {
      if (shared.failWrites) throw new Error("disk is full");
      if (
        shared.configurations.some(
          (item) => item.id !== entry.id && item.name.toLowerCase() === entry.name.toLowerCase(),
        )
      )
        throw new Error("A run configuration with that name already exists");
      shared.configurations = [
        ...shared.configurations.filter((item) => item.id !== entry.id),
        structuredClone(entry),
      ];
    },
    deleteConfiguration: (id) => {
      shared.configurations = shared.configurations.filter((item) => item.id !== id);
    },
    useConfiguration: (id, at) => {
      if (shared.failWrites) throw new Error("disk is full");
      const entry = shared.configurations.find((item) => item.id === id);
      if (entry) {
        entry.uses++;
        entry.lastUsed = at;
      }
    },
    promptTemplates: () => ({ templates: { ...shared.prompts }, skipped: [] }),
    savePromptTemplate: (id, template) => {
      if (shared.failWrites) throw new Error("disk is full");
      if (id === "operatingContract" && typeof template !== "string")
        shared.prompts.operatingContract = structuredClone(template);
      else if (id !== "operatingContract" && typeof template === "string")
        shared.prompts[id] = template;
    },
    deletePromptTemplate: (id) => {
      delete shared.prompts[id];
    },
    close: () => {
      open = false;
    },
  };
});
const preferences: DesktopPreferences = {
  agentSetup: async () =>
    orchestrationProvider
      ? verifiedAgents(
          {
            ...DEFAULT_CONFIG,
            agents: {
              ...DEFAULT_CONFIG.agents,
              ...(orchestrationProvider === "removed"
                ? { removed: { command: ["removed"] as const } }
                : {}),
            },
          },
          orchestrationProvider,
        )
      : null,
  orchestrationProvider: async () => orchestrationProvider,
  setOrchestrationProvider: async (provider) => {
    if (preferencesFail) throw new Error("read-only");
    orchestrationProvider = provider;
  },
  read: async () => stored,
  write: async (path) => {
    if (preferencesFail) throw new Error("read-only");
    stored = path;
  },
};
const realOf = (path: string) => fs.realpath(path).catch(() => path);
const controllerDeps = (): CoreDeps => {
  const processes = new FakeProcesses();
  processes.alive.add(process.pid);
  return {
    agents,
    git,
    fs: {
      ...defaultDeps().fs,
      readdir: async (path) => {
        const ids = await fs.readdir(path);
        await listGate?.();
        return ids;
      },
    },
    ownerPid: process.pid,
    clock: {
      now: () => new Date(Date.UTC(2026, 0, 1) + tick++ * 1000),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as NodeJS.Timeout),
    },
    processes,
  };
};

beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), "code60-desktop-"));
  agents = new FakeAgents();
  git = new FakeGit();
  git.repoInfo = async () => ({ topLevel: directory, commonDir: join(directory, ".git") });
  confirm = vi.fn(async () => true);
  databases.clear();
  stored = undefined;
  preferencesFail = false;
  orchestrationProvider = null;
  listGate = undefined;
  controller = new DesktopController(
    controllerDeps(),
    {
      XDG_CONFIG_HOME: join(directory, "config"),
      XDG_STATE_HOME: join(directory, "state"),
    },
    { confirm },
    { openDatabase, preferences },
  );
  // These controller scenarios start after onboarding; wizard integration has separate tests.
  // biome-ignore lint/complexity/useLiteralKeys: Seed isolated post-setup lifecycle fixtures without exposing a production bypass.
  controller["agentSetup"].restore(verifiedAgents(DEFAULT_CONFIG));
  await controller.connect(join(directory, "first.sqlite"), true);
});
afterEach(async () => {
  await controller.shutdown(true);
  await fs.rm(directory, { recursive: true, force: true });
});

// Simulate a successfully committed setup for tests of downstream chat lifecycles.
// The public wizard transaction and gate are covered in agent-setup.test.ts.
async function setProvider(provider: string | null) {
  if (preferencesFail) throw new Error("read-only");
  const config = await loadConfig(controllerDeps().fs, {
    XDG_CONFIG_HOME: join(directory, "config"),
  });
  if (provider && !config.agents[provider]) throw new Error(`Unavailable provider: ${provider}`);
  if (provider === null) {
    orchestrationProvider = null;
    // biome-ignore lint/complexity/useLiteralKeys: Seed isolated post-setup lifecycle fixtures without exposing a production bypass.
    await controller["stopMemoryExtraction"]();
    // biome-ignore lint/complexity/useLiteralKeys: Seed isolated post-setup lifecycle fixtures without exposing a production bypass.
    await controller["stopSearchSummary"]();
    await controller.restore();
  } else {
    // biome-ignore lint/complexity/useLiteralKeys: Seed isolated post-setup lifecycle fixtures without exposing a production bypass.
    controller["agentSetup"].restore(verifiedAgents(config, provider));
    await controller.setOrchestrationProvider(provider);
  }
}

async function start(prompt?: string) {
  await controller.open(directory);
  await controller.start({ ...request, ...(prompt === undefined ? {} : { prompt }) });
  await vi.waitFor(() => expect(controller.snapshot().runs[0]?.view?.status).toBe("idle"));
  return controller.snapshot().runs[0]?.record.id as string;
}

async function configureMcp(version = "first") {
  const path = join(directory, "config", "code60");
  await fs.mkdir(path, { recursive: true });
  await fs.writeFile(
    join(path, "config.json"),
    JSON.stringify({
      mcpServers: {
        tools: {
          type: "stdio",
          command: "node",
          args: [`/private/${version}.js`],
          env: { TOKEN: `private-${version}` },
        },
      },
    }),
  );
  await controller.poll(["config"]);
  return [
    {
      name: "tools",
      type: "stdio",
      command: "node",
      args: [`/private/${version}.js`],
      env: [{ name: "TOKEN", value: `private-${version}` }],
    },
  ];
}

describe("retained project runtimes", () => {
  it("keeps Relay workspace file reads independent of databases and invalidates contexts on reload", async () => {
    await prepareRelay();
    const relay = controller.snapshot().chat;
    const details: DetailRequest = {
      subscriptionId: randomUUID(),
      scope: {
        kind: "conversation",
        conversationId: relay.conversationId as string,
        generation: relay.generation as number,
      },
    };
    await fs.writeFile(join(relay.directory as string, "relay-note.txt"), "Relay workspace only");
    const frames: DetailFrame[] = [];
    controller.subscribeDetails(details, (frame) => frames.push(frame));
    controller.setVisibility({ visible: true, worktrees: false });
    const context = {
      subscriptionId: details.subscriptionId,
      sequence: 1,
      active: true,
      directories: [""],
      preview: "relay-note.txt",
    };
    controller.setRelayFileContext(context);
    await vi.waitFor(() =>
      expect(controller.readDetails(details)).toMatchObject({
        payload: { files: { context, preview: { text: "Relay workspace only" } } },
      }),
    );
    const a = await project("a");
    await fs.writeFile(join(a.path, "relay-note.txt"), "Not Relay");
    await controller.connect(join(directory, "replacement.sqlite"), true);
    expect(controller.readDetails(details)).toMatchObject({
      payload: { files: { preview: { text: "Relay workspace only" } } },
    });
    expect(agents.sessions[0]?.prompts).toEqual([]);
    expect(controller.snapshot().files).toBeNull();
    expect(frames.every((frame) => !frame.closed)).toBe(true);
    controller.clearDetailSubscriptions();
    expect(() => controller.setRelayFileContext({ ...context, sequence: 2 })).toThrow(
      "no longer available",
    );
    expect(() => controller.readDetails(details)).toThrow("no longer available");
    expect(() => controller.setRelayFileContext({ ...context, root: a.path })).toThrow();
  });

  it("binds Relay target files to an owned target and refuses a replaced root or project subscription", async () => {
    await prepareRelay();
    const relay = controller.snapshot().chat;
    const relayId = relay.run?.id as string;
    const a = await project("a");
    await fs.writeFile(join(a.path, "target-note.txt"), "Owned target");
    await controller.orchestrationChatAction({ type: "send", id: relayId, text: "Work in A" });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    const authority = await call(relayId, "code60_get_context");
    await call(relayId, "code60_dispatch_agent", {
      scope: authority.scope,
      requestId: "target-files",
      cwd: a.path,
      workspaceMode: "direct",
      prompt: "A work",
    });
    await vi.waitFor(() =>
      expect(controller.snapshot().runs.find((run) => run.relay)?.view?.status).toBe("idle"),
    );
    const target = controller.snapshot().runs.find((run) => run.relay)?.relay;
    if (!target) throw new Error("Missing target");
    const details: DetailRequest = {
      subscriptionId: randomUUID(),
      scope: {
        kind: "target",
        targetId: target.targetId,
        conversationId: target.conversationId,
        generation: target.generation,
      },
    };
    controller.subscribeDetails(details, () => {});
    controller.setVisibility({ visible: true, worktrees: false });
    const context = {
      subscriptionId: details.subscriptionId,
      sequence: 1,
      active: true,
      directories: [""],
      preview: "target-note.txt",
    };
    controller.setRelayFileContext(context);
    await vi.waitFor(() =>
      expect(controller.readDetails(details)).toMatchObject({
        payload: { files: { preview: { text: "Owned target" } } },
      }),
    );
    const projectDetails: DetailRequest = {
      subscriptionId: randomUUID(),
      scope: {
        kind: "project",
        projectId: a.id,
        databaseEpoch: controller.snapshot().databaseEpoch as number,
      },
    };
    controller.subscribeDetails(projectDetails, () => {});
    expect(() =>
      controller.setRelayFileContext({ ...context, subscriptionId: projectDetails.subscriptionId }),
    ).toThrow("Relay file generation");
    await controller.projectAction({ type: "close", projectId: a.id });
    expect(controller.readDetails(details)).toMatchObject({
      payload: { files: { preview: { text: "Owned target" } } },
    });
    await fs.rename(a.path, `${a.path}-original`);
    await fs.mkdir(a.path);
    await fs.writeFile(join(a.path, "target-note.txt"), "Unauthorized replacement");
    controller.setRelayFileContext({ ...context, sequence: 2 });
    await vi.waitFor(() =>
      expect(controller.readDetails(details)).toMatchObject({
        payload: {
          filePolling: { failures: 1, lastError: expect.stringContaining("identity changed") },
        },
      }),
    );
    expect(JSON.stringify(controller.readDetails(details))).not.toContain(
      "Unauthorized replacement",
    );
  });

  it("keeps project and conversation detail subscriptions bound across navigation and rejects reopened owners", async () => {
    await prepareRelay();
    const a = await project("a");
    const chatA = await newChat(a.id);
    const [workerA] = await controller.start(request);
    await vi.waitFor(() => expect(controller.snapshot().runs[0]?.view?.status).toBe("idle"));
    const epoch = controller.snapshot().databaseEpoch as number;
    const projectDetails: DetailRequest = {
      subscriptionId: randomUUID(),
      scope: { kind: "project", projectId: a.id, databaseEpoch: epoch },
    };
    const conversationDetails: DetailRequest = {
      subscriptionId: randomUUID(),
      scope: {
        kind: "conversation",
        conversationId: chatA.run?.id as string,
        generation: chatA.generation as number,
        projectId: a.id,
        databaseEpoch: epoch,
      },
    };
    const projectFrames: DetailFrame[] = [];
    const chatFrames: DetailFrame[] = [];
    controller.subscribeDetails(projectDetails, (frame) => projectFrames.push(frame));
    controller.subscribeDetails(conversationDetails, (frame) => chatFrames.push(frame));
    expect(controller.readDetails(projectDetails)).toMatchObject({
      previousRevision: null,
      payload: {
        kind: "project",
        projectId: a.id,
        directory: a.path,
        runs: [{ record: { id: workerA } }],
      },
    });
    const b = await project("b");
    await newChat(b.id);
    await controller.orchestrationChatAction({
      type: "send",
      id: chatA.run?.id as string,
      text: "Background A detail",
    });
    await vi.waitFor(() =>
      expect(
        chatFrames.some(
          (frame) =>
            !frame.closed &&
            frame.payload.kind === "conversation" &&
            frame.payload.chat.events.some(
              ({ event }) => event.type === "prompt" && event.text === "Background A detail",
            ),
        ),
      ).toBe(true),
    );
    expect(controller.snapshot().directory).toBe(b.path);
    expect(controller.readDetails(conversationDetails)).toMatchObject({
      payload: { kind: "conversation", chat: { projectId: a.id, generation: chatA.generation } },
    });
    await controller.projectAction({ type: "close", projectId: a.id });
    await vi.waitFor(() => {
      expect(projectFrames.at(-1)).toMatchObject({ closed: true });
      expect(chatFrames.at(-1)).toMatchObject({ closed: true });
    });
    await controller.open(a.path, epoch);
    expect(controller.snapshot().projectInstanceId).not.toBe(a.id);
    expect(() => controller.readDetails(projectDetails)).toThrow("no longer available");
    expect(() =>
      controller.subscribeDetails({ ...projectDetails, subscriptionId: randomUUID() }, () => {}),
    ).toThrow("no longer open");
    expect(agents.sessions[0]?.prompts).toEqual([]);
  });

  it("keeps Relay details across database replacement and clears all subscriptions on renderer reload", async () => {
    await prepareRelay();
    const relay = controller.snapshot().chat;
    const relayDetails: DetailRequest = {
      subscriptionId: randomUUID(),
      scope: {
        kind: "conversation",
        conversationId: relay.conversationId as string,
        generation: relay.generation as number,
      },
    };
    controller.subscribeDetails(relayDetails, () => {});
    const a = await project("a");
    const projectDetails: DetailRequest = {
      subscriptionId: randomUUID(),
      scope: {
        kind: "project",
        projectId: a.id,
        databaseEpoch: controller.snapshot().databaseEpoch as number,
      },
    };
    controller.subscribeDetails(projectDetails, () => {});
    await controller.connect(
      join(directory, "second.sqlite"),
      true,
      projectDetails.scope.kind === "project" ? projectDetails.scope.databaseEpoch : undefined,
    );
    expect(controller.readDetails(relayDetails)).toMatchObject({
      payload: {
        kind: "conversation",
        chat: { conversationId: relay.conversationId, generation: relay.generation },
      },
    });
    expect(() => controller.readDetails(projectDetails)).toThrow(
      /no longer open|no longer available/,
    );
    controller.clearDetailSubscriptions();
    expect(() => controller.readDetails(relayDetails)).toThrow("no longer available");
    controller.subscribeDetails({ ...relayDetails, subscriptionId: randomUUID() }, () => {});
    expect(agents.sessions[0]?.prompts).toEqual([]);
  });

  it("publishes only the polled project's details and isolates failed app listeners", async () => {
    await prepareRelay();
    const a = await project("a");
    const b = await project("b");
    controller.setPollingPaused(true);
    const epoch = controller.snapshot().databaseEpoch as number;
    await new Promise<void>((resolve) => {
      const release = controller.subscribe(() => {
        release();
        resolve();
      }, true);
    });
    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(100);
      const aFrames = vi.fn();
      const bFrames = vi.fn();
      const good = vi.fn();
      const bad = vi.fn(() => {
        throw new Error("Listener gone");
      });
      controller.subscribe(bad, true);
      controller.subscribe(good, true);
      for (const [projectId, emit] of [
        [a.id, aFrames],
        [b.id, bFrames],
      ] as const)
        controller.subscribeDetails(
          {
            subscriptionId: randomUUID(),
            scope: { kind: "project", projectId, databaseEpoch: epoch },
          },
          emit,
        );
      await controller.poll(["history"], { projectId: b.id, databaseEpoch: epoch });
      await vi.advanceTimersByTimeAsync(100);
      expect(aFrames).not.toHaveBeenCalled();
      expect(bFrames).toHaveBeenCalledOnce();
      expect(good).toHaveBeenCalledOnce();
      expect(bad).toHaveBeenCalledOnce();
      await controller.poll(["history"], { projectId: a.id, databaseEpoch: epoch });
      await vi.advanceTimersByTimeAsync(100);
      expect(aFrames).toHaveBeenCalledOnce();
      expect(bFrames).toHaveBeenCalledOnce();
      expect(good).toHaveBeenCalledTimes(2);
      expect(bad).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("omits hidden worktree sizes and invalidates an in-flight size scan on hide", async () => {
    await prepareRelay();
    const a = await project("a");
    controller.setPollingPaused(true);
    const epoch = controller.snapshot().databaseEpoch as number;
    const listing = vi.spyOn(git as Git, "listWorktrees");
    await controller.poll(["worktrees"], { projectId: a.id, databaseEpoch: epoch });
    expect(listing).toHaveBeenLastCalledWith(a.path, expect.objectContaining({ sizes: false }));
    controller.setVisibility({ visible: true, files: false, worktrees: true });
    listing.mockImplementationOnce(async (_root, options) => {
      expect(options?.sizes).toBe(true);
      expect(options?.current?.()).toBe(true);
      controller.setVisibility({ visible: true, files: false, worktrees: false });
      expect(options?.current?.()).toBe(false);
      return [];
    });
    await controller.poll(["worktrees"], { projectId: a.id, databaseEpoch: epoch });
    expect(controller.snapshot().worktrees?.worktrees).toEqual([]);
  });

  it("publishes compact inactive chat summaries without transcripts or plan documents and preserves progress/reply counts", async () => {
    await prepareRelay();
    const a = await project("a");
    agents.script = () => "hang";
    const chatA = await newChat(a.id);
    const session = agents.sessions.at(-1);
    await controller.orchestrationChatAction({
      type: "send",
      id: chatA.run?.id as string,
      text: "Background task",
    });
    await vi.waitFor(() => expect(session?.turnActive).toBe(true));
    await call(chatA.run?.id as string, "code60_create_plan", {
      requestId: "compact-plan",
      title: "Compact progress",
      description: "p".repeat(16_000),
      tasks: [{ text: "t".repeat(2_000) }],
    });
    const b = await project("b");
    await newChat(b.id);
    const summaries = vi.fn();
    const off = controller.subscribe(summaries, true);
    try {
      session?.update({ type: "message", text: "😀".repeat(64_000) });
      session?.update({ type: "message", text: "Additional chunk" });
      const full = controller.snapshot().chats.find((chat) => chat.run?.id === chatA.run?.id);
      expect(full?.events.length).toBeGreaterThan(0);
      const compact = controller
        .snapshot(true, true)
        .chats.find((chat) => chat.run?.id === chatA.run?.id);
      expect(compact).toMatchObject({
        events: [],
        plans: [{ title: "Compact progress", proposalRevision: 1, completed: 0, total: 1 }],
        replies: { count: 1, lastTurn: 1 },
      });
      expect(compact?.plans?.[0]).not.toHaveProperty("description");
      expect(compact?.plans?.[0]).not.toHaveProperty("tasks");
      expect(JSON.stringify(compact).length).toBeLessThan(8_000);
      await vi.waitFor(() => expect(summaries).toHaveBeenCalled());
      expect(
        summaries.mock.lastCall?.[0].chats.find(
          (chat: { projectId?: string }) => chat.projectId === a.id,
        ),
      ).toMatchObject({
        events: [],
        plans: [{ title: "Compact progress", proposalRevision: 1, completed: 0, total: 1 }],
        replies: { count: 1, lastTurn: 1 },
      });
      await controller.projectAction({ type: "select", projectId: a.id });
      expect(controller.snapshot(true, true)).toMatchObject({
        summaryOnly: true,
        events: [],
        files: null,
        worktrees: null,
        reviews: [],
        chat: { events: [], replies: { count: 1 } },
      });
      expect(JSON.stringify(controller.snapshot(true, true))).not.toContain("Additional chunk");
      expect(controller.snapshot().chat.events.length).toBeGreaterThan(0);
    } finally {
      off();
    }
  });

  it.each(["chat", "worker"] as const)(
    "resumes only the originating project's delivery after a slow %s mode change",
    async (kind) => {
      await prepareRelay();
      const a = await project("a");
      const chat = await newChat(a.id);
      let id = chat.run?.id as string;
      if (kind === "worker") {
        [id] = (await controller.start(request)) as [string];
        await vi.waitFor(() => expect(controller.snapshot().runs[0]?.view?.status).toBe("idle"));
      }
      const primary = agents.sessions.at(-1);
      if (!primary) throw new Error("Missing mode session");
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      Object.assign(primary, { setMode: () => gate });
      primary.update({
        type: "sessionState",
        state: {
          model: null,
          usage: null,
          modes: {
            source: "config",
            confirmed: true,
            reportedAt: "2026-11-07T12:00:00.000Z",
            controls: [
              {
                id: "permissions",
                name: "Permissions",
                currentValue: "ask",
                options: [{ value: "ask", name: "Ask" }],
              },
            ],
          },
        },
      });
      const coordinator = () =>
        (controller as unknown as { conversations: ConversationCoordinator }).conversations;
      const aCoordinator = coordinator();
      const change = { source: "config" as const, configId: "permissions", value: "ask" };
      const pending =
        kind === "chat"
          ? controller.orchestrationChatAction({ type: "set-mode", id, change })
          : controller.action({ type: "set-mode", id, change });
      try {
        await vi.waitFor(() =>
          expect(
            kind === "chat"
              ? controller.snapshot().chat.run?.modeChanging
              : controller.snapshot().runs[0]?.view?.modeChanging,
          ).toBe(true),
        );
        const b = await project("b");
        const aUpdates = vi.spyOn(aCoordinator, "scheduleUpdates");
        const bUpdates = vi.spyOn(coordinator(), "scheduleUpdates");
        release();
        await pending;
        expect(aUpdates).toHaveBeenCalled();
        expect(bUpdates).not.toHaveBeenCalled();
        expect(controller.snapshot().directory).toBe(b.path);
      } finally {
        release();
        await pending;
      }
    },
  );

  it("finishes a selected project's diff after navigating without changing its owner", async () => {
    await prepareRelay();
    const a = await project("a");
    const [worker] = await controller.start(request);
    await vi.waitFor(() => expect(controller.snapshot().runs[0]?.view?.status).toBe("idle"));
    const b = await project("b");
    await controller.projectAction({ type: "select", projectId: a.id });
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = vi.spyOn(git, "diff").mockImplementation(async () => {
      await blocked;
      return "A diff";
    });
    const pending = controller
      .readDiff({ requestId: randomUUID(), id: worker as string })
      .catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(read).toHaveBeenCalled());
      await controller.projectAction({ type: "select", projectId: b.id });
      release();
      expect(await pending).toBe("A diff");
      expect(controller.snapshot().directory).toBe(b.path);
    } finally {
      release();
      await pending;
    }
  });

  it.each(["close", "stop-folder", "discard"] as const)(
    "%s settles only the affected project's diff reads",
    async (type) => {
      await prepareRelay();
      const a = await project("a");
      const [aWorker] = await controller.start(request);
      await vi.waitFor(() => expect(controller.snapshot().runs[0]?.view?.status).toBe("idle"));
      await controller.action({ type: "finish", id: aWorker as string });
      const b = await project("b");
      const [bWorker] = await controller.start(request);
      await vi.waitFor(() => expect(controller.snapshot().runs[0]?.view?.status).toBe("idle"));
      await controller.action({ type: "finish", id: bWorker as string });
      const signals: AbortSignal[] = [];
      const releases: (() => void)[] = [];
      vi.spyOn(git, "diff").mockImplementation(
        async (_worktree, _base, signal) =>
          new Promise<string>((resolve, reject) => {
            if (!signal) throw new Error("Missing read cancellation");
            signals.push(signal);
            const abort = () => reject(signal.reason);
            signal.addEventListener("abort", abort, { once: true });
            releases.push(() => {
              signal.removeEventListener("abort", abort);
              resolve("Other project's diff");
            });
          }),
      );
      const first = controller
        .readDiff({ requestId: randomUUID(), id: aWorker as string })
        .catch((error: unknown) => error);
      await vi.waitFor(() => expect(signals).toHaveLength(1));
      const second = controller
        .readDiff({ requestId: randomUUID(), id: bWorker as string })
        .catch((error: unknown) => error);
      try {
        await vi.waitFor(() => expect(signals).toHaveLength(2));
        if (type === "discard") await controller.action({ type, id: aWorker as string });
        else await controller.projectAction({ type, projectId: a.id });
        expect(signals[0]?.aborted).toBe(true);
        expect(signals[1]?.aborted).toBe(false);
        expect(await first).toBeInstanceOf(Error);
        releases[1]?.();
        expect(await second).toBe("Other project's diff");
        expect(controller.snapshot().directory).toBe(b.path);
      } finally {
        for (const release of releases) release();
        await Promise.allSettled([first, second]);
      }
    },
  );

  it("closing a project cancels its review capture without cancelling another project's diff", async () => {
    await prepareRelay();
    const a = await project("a");
    const [worker] = await controller.start(request);
    await vi.waitFor(() => expect(controller.snapshot().runs[0]?.view?.status).toBe("idle"));
    const store = (controller as unknown as { reviews: ReviewStore }).reviews;
    const review = await store.create(null, 0, "A review");
    await store.addWorker(review.id, worker as string, "A worker");
    const identity = {
      project: a.path,
      projectId: a.id,
      databaseEpoch: controller.snapshot().databaseEpoch,
      reviewId: review.id,
      requestId: randomUUID(),
    };
    const b = await project("b");
    const [other] = await controller.start(request);
    await vi.waitFor(() => expect(controller.snapshot().runs[0]?.view?.status).toBe("idle"));
    const signals: AbortSignal[] = [];
    const releases: (() => void)[] = [];
    const blocked = (signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (!signal) throw new Error("Missing read cancellation");
        signals.push(signal);
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        releases.push(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        });
      });
    const adapter: CoreDeps["git"] = git;
    adapter.reviewSnapshot = async (_worktree, _base, signal) => {
      await blocked(signal);
      return { files: [], truncated: false };
    };
    vi.spyOn(git, "diff").mockImplementation(async (_worktree, _base, signal) => {
      await blocked(signal);
      return "B diff";
    });
    const capture = controller.captureReview(identity).catch((error: unknown) => error);
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    const diff = controller
      .readDiff({ requestId: randomUUID(), id: other as string })
      .catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(signals).toHaveLength(2));
      await controller.projectAction({ type: "close", projectId: a.id });
      expect(signals[0]?.aborted).toBe(true);
      expect(signals[1]?.aborted).toBe(false);
      expect(await capture).toBeInstanceOf(Error);
      releases[1]?.();
      expect(await diff).toBe("B diff");
      expect(store.get(review.id).revisions).toEqual([]);
      expect(controller.snapshot().directory).toBe(b.path);
    } finally {
      for (const release of releases) release();
      await Promise.allSettled([capture, diff]);
    }
  });

  it("does not hold the control queue across slow history reads and discards a closed owner's result", async () => {
    await prepareRelay();
    const a = await project("a");
    await fs.mkdir(join(a.path, ".git", "code60", "runs"), { recursive: true });
    const epoch = controller.snapshot().databaseEpoch as number;
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = vi.fn();
    listGate = async () => {
      entered();
      await blocked;
    };
    try {
      const pending = controller.poll(["history"], { projectId: a.id, databaseEpoch: epoch });
      await vi.waitFor(() => expect(entered).toHaveBeenCalled());
      await controller.projectAction({ type: "close", projectId: a.id });
      expect(controller.snapshot().openProjects).toEqual([]);
      listGate = undefined;
      release();
      await pending;
      await controller.open(a.path, epoch);
      expect(controller.snapshot().projectInstanceId).not.toBe(a.id);
      expect(
        controller.snapshot().polling.sources.find((source) => source.key === "history")?.history,
      ).toEqual([]);
    } finally {
      listGate = undefined;
      release();
    }
  });

  it("keeps explicit polling bound before deferred reads and preserves independent target histories", async () => {
    await prepareRelay();
    const a = await project("a");
    const b = await project("b");
    const epoch = controller.snapshot().databaseEpoch as number;
    const address = (projectId: string) => ({ projectId, databaseEpoch: epoch });
    await controller.projectAction({ type: "select", projectId: a.id });
    const adapter: CoreDeps["git"] = git;
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = vi.spyOn(adapter, "listWorktrees").mockImplementation(async (root) => {
      if (root === a.path) await blocked;
      return [];
    });
    try {
      const pending = controller.poll(["worktrees"], address(a.id));
      await controller.projectAction({ type: "select", projectId: b.id });
      await vi.waitFor(() =>
        expect(read).toHaveBeenCalledWith(a.path, expect.objectContaining({ sizes: false })),
      );
      await controller.poll(["worktrees"], address(b.id));
      expect(controller.snapshot().worktrees?.repository).toBe("b");
      release();
      await pending;
      expect(controller.snapshot().worktrees?.repository).toBe("b");
      await controller.projectAction({ type: "select", projectId: a.id });
      expect(controller.snapshot().worktrees?.repository).toBe("a");
      expect(
        controller.snapshot().polling.sources.find((source) => source.key === "worktrees"),
      ).toMatchObject({ scope: { kind: "target", id: a.id }, history: [expect.anything()] });
      await expect(controller.poll(["history"], {})).rejects.toThrow("database epoch");
      await expect(controller.poll(["history"], { databaseEpoch: epoch })).rejects.toThrow(
        "project identity",
      );
      await expect(
        controller.poll(["history"], { projectId: b.id, databaseEpoch: epoch + 1 }),
      ).rejects.toThrow("instance changed");
      await controller.poll(["config"], {});
      await controller.poll(["configurations"], { databaseEpoch: epoch });
      await controller.projectAction({ type: "close", projectId: a.id });
      await controller.open(a.path, epoch);
      await expect(controller.poll(["worktrees"], address(a.id))).rejects.toThrow("no longer open");
      expect(agents.sessions[0]?.prompts).toEqual([]);
    } finally {
      release();
      read.mockRestore();
    }
  });

  it("fences native-picker results and project history across queued replacement and same-path reopen", async () => {
    await prepareRelay();
    const a = await project("a");
    const firstPath = controller.snapshot().database as string;
    const epoch = controller.snapshot().databaseEpoch as number;
    const relayId = controller.snapshot().chat.conversationId;
    expect(controller.assertDatabaseRequest(epoch)).toBe(epoch);
    for (const bad of [undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, epoch + 1]) {
      expect(() => controller.assertDatabaseRequest(bad)).toThrow(/epoch|instance changed/);
      await expect(controller.openProject(a.path, bad)).rejects.toThrow(/epoch|instance changed/);
      await expect(controller.removeProject(a.path, bad)).rejects.toThrow(/epoch|instance changed/);
      await expect(controller.clearProjects(bad)).rejects.toThrow(/epoch|instance changed/);
    }
    const original = structuredClone(databases.get(firstPath));
    const replacement = join(directory, "history-replacement.sqlite");
    const replacing = controller.connect(replacement, true, epoch);
    const queued = [
      controller.connect(join(directory, "must-not-create.sqlite"), true, epoch),
      controller.open(a.path, epoch),
      controller.openProject(a.path, epoch),
      controller.removeProject(a.path, epoch),
      controller.clearProjects(epoch),
    ];
    const rejected = Promise.all(
      queued.map((request) => expect(request).rejects.toThrow(/instance|database/)),
    );
    await replacing;
    await rejected;
    expect(databases.has(join(directory, "must-not-create.sqlite"))).toBe(false);
    expect(databases.get(firstPath)).toEqual(original);
    expect(controller.snapshot().projects).toEqual([]);
    expect(() => controller.assertDatabaseRequest(epoch)).toThrow("database instance changed");
    await controller.connect(firstPath, false, controller.snapshot().databaseEpoch);
    expect(controller.snapshot().database).toBe(firstPath);
    await expect(controller.open(a.path, epoch)).rejects.toThrow("database instance changed");
    await expect(controller.openProject(a.path, epoch)).rejects.toThrow(
      "database instance changed",
    );
    await expect(controller.removeProject(a.path, epoch)).rejects.toThrow(
      "database instance changed",
    );
    await expect(controller.clearProjects(epoch)).rejects.toThrow("database instance changed");
    const current = controller.snapshot().databaseEpoch as number;
    await controller.openProject(a.path, current);
    await controller.removeProject(a.path, current);
    expect(controller.snapshot().projects).toEqual([]);
    await controller.open(a.path, current);
    expect(await controller.clearProjects(current)).toBe(true);
    expect(controller.snapshot().projects).toEqual([]);
    expect(controller.snapshot().chat.conversationId).toBe(relayId);
    expect(agents.sessions[0]?.prompts).toEqual([]);
  });

  it("fences database writes after replacement without changing Relay or either saved database", async () => {
    await prepareRelay();
    const relayId = controller.snapshot().chat.run?.id;
    const firstPath = controller.snapshot().database as string;
    const epoch = controller.snapshot().databaseEpoch as number;
    const command = { name: "epoch-check", title: "First", prompt: "Original" };
    const template = { id: "handoffTurn" as const, template: "Edit {{message}}" };
    await controller.saveCommand(command, epoch);
    await controller.saveConfiguration({ name: "First", settings: request }, epoch);
    await controller.savePromptTemplate(template, epoch);
    const commandId = controller.snapshot().commands[0]?.id as string;
    const configurationId = controller.snapshot().configurations[0]?.id as string;
    const operations = (databaseEpoch?: number) => [
      () => controller.saveCommand(command, databaseEpoch),
      () => controller.deleteCommand({ id: commandId }, databaseEpoch),
      () => controller.saveConfiguration({ name: "Stale", settings: request }, databaseEpoch),
      () => controller.deleteConfiguration(configurationId, databaseEpoch),
      () => controller.savePromptTemplate(template, databaseEpoch),
      () => controller.resetPromptTemplate(template.id, databaseEpoch),
    ];
    for (const bad of [undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, epoch + 1])
      for (const operation of operations(bad))
        await expect(operation()).rejects.toThrow(/epoch|database instance changed/);
    const first = structuredClone(databases.get(firstPath));
    const secondPath = join(directory, "epoch-replacement.sqlite");
    const replacing = controller.connect(secondPath, true);
    const queued = controller.saveCommand({ ...command, name: "queued" }, epoch);
    const rejected = expect(queued).rejects.toThrow(/instance|database/);
    await replacing;
    await rejected;
    for (const operation of operations(epoch))
      await expect(operation()).rejects.toThrow("database instance changed");
    expect(databases.get(firstPath)).toEqual(first);
    expect(controller.snapshot().commands).toEqual([]);
    expect(controller.snapshot().configurations).toEqual([]);
    expect(databases.get(secondPath)?.prompts).toEqual({});
    const current = controller.snapshot().databaseEpoch as number;
    await controller.saveCommand({ ...command, name: "current" }, current);
    await controller.saveConfiguration({ name: "Current", settings: request }, current);
    await controller.savePromptTemplate(template, current);
    await controller.deleteCommand(
      { id: controller.snapshot().commands[0]?.id as string },
      current,
    );
    await controller.deleteConfiguration(
      controller.snapshot().configurations[0]?.id as string,
      current,
    );
    await controller.resetPromptTemplate(template.id, current);
    expect(controller.snapshot().commands).toEqual([]);
    expect(controller.snapshot().configurations).toEqual([]);
    expect(databases.get(secondPath)?.prompts).toEqual({});
    expect(controller.snapshot().chat.run?.id).toBe(relayId);
    expect(agents.sessions[0]?.prompts).toEqual([]);
  });

  it("keeps selected-owner review and file reads bound across navigation during awaits", async () => {
    await prepareRelay();
    const a = await project("a");
    const store = (controller as unknown as { reviews: ReviewStore }).reviews;
    const review = await store.create(null, 0, "A review");
    await store.capture(review.id, [
      {
        runId: "worker",
        files: [
          {
            path: "a.txt",
            oldPath: "a.txt",
            status: "modified",
            original: "before",
            modified: "after",
            fingerprint: "a",
          },
        ],
      },
    ]);
    const revisionId = store.get(review.id).revisions[0]?.id as string;
    const identity = {
      project: a.path,
      projectId: a.id,
      databaseEpoch: controller.snapshot().databaseEpoch as number,
      reviewId: review.id,
    };
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stats = store.withLineStats.bind(store);
    const content = store.content.bind(store);
    const statsRead = vi.spyOn(store, "withLineStats").mockImplementation(async (...args) => {
      await gate;
      return stats(...args);
    });
    const fileRead = vi.spyOn(store, "content").mockImplementation(async (...args) => {
      await gate;
      return content(...args);
    });
    const reading = controller.readReview({ ...identity, revisionId, requestId: randomUUID() });
    const readingFile = controller.readReviewFile({
      ...identity,
      revisionId,
      requestId: randomUUID(),
      fileKey: "worker:a.txt",
    });
    await vi.waitFor(() => {
      expect(statsRead).toHaveBeenCalled();
      expect(fileRead).toHaveBeenCalled();
    });
    const b = await project("b");
    release();
    expect(await reading).toMatchObject({
      id: review.id,
      projectId: a.id,
      databaseEpoch: identity.databaseEpoch,
    });
    expect(await readingFile).toMatchObject({ original: "before", modified: "after" });
    expect(controller.snapshot().directory).toBe(b.path);
    expect(controller.snapshot().reviews).toEqual([]);
  });

  it("rejects stale review, task and Git identities without remapping reopened paths", async () => {
    await prepareRelay();
    const a = await project("a");
    const store = (controller as unknown as { reviews: ReviewStore }).reviews;
    const review = await store.create(null, 0, "Historical evidence");
    const identity = {
      project: a.path,
      projectId: a.id,
      databaseEpoch: controller.snapshot().databaseEpoch as number,
    };
    expect(controller.snapshot().reviews?.[0]).toMatchObject(identity);
    const requests = (scope: ProjectRequestIdentity & { project: string }) => [
      () => controller.readReview({ ...scope, reviewId: review.id, requestId: randomUUID() }),
      () =>
        controller.readReviewFile({
          ...scope,
          reviewId: review.id,
          revisionId: randomUUID(),
          requestId: randomUUID(),
          fileKey: "worker:a.txt",
        }),
      () => controller.captureReview({ ...scope, reviewId: review.id, requestId: randomUUID() }),
      () => controller.reviewAction({ ...scope, type: "open-run", runId: "worker" }),
      () =>
        controller.reviewAction({
          ...scope,
          type: "delete-comment",
          reviewId: review.id,
          id: randomUUID(),
        }),
      () => controller.taskAction({ ...scope, type: "status", reviewId: review.id }),
      () => controller.taskAction({ ...scope, type: "cancel", reviewId: review.id }),
      () =>
        controller.taskAction({
          ...scope,
          type: "apply",
          reviewId: review.id,
          operationId: randomUUID(),
        }),
      () => controller.checkGit(scope),
      () => controller.beginGitSetup(scope),
      () =>
        controller.previewGitSetupFile({
          ...scope,
          sessionId: randomUUID(),
          fileId: randomUUID(),
        }),
      () => controller.initializeGit({ ...scope, sessionId: randomUUID() }),
      () =>
        controller.commitGitSetup({
          ...scope,
          sessionId: randomUUID(),
          fileIds: [],
          name: "Test",
          email: "test@example.invalid",
        }),
      () => controller.cancelGitSetup(scope),
    ];
    for (const bad of [
      { ...identity, databaseEpoch: identity.databaseEpoch + 1 },
      { ...identity, project: join(directory, "different") },
      { ...identity, projectId: randomUUID() },
      { project: a.path },
    ])
      for (const operation of requests(bad))
        await expect(operation()).rejects.toThrow(/identity|no longer open/);
    await controller.projectAction({ type: "close", projectId: a.id });
    await controller.open(a.path);
    const reopened = controller.snapshot().projectInstanceId as string;
    expect(reopened).not.toBe(a.id);
    for (const operation of requests(identity))
      await expect(operation()).rejects.toThrow("no longer open");
    expect(
      await controller.readReview({
        ...identity,
        projectId: reopened,
        reviewId: review.id,
        requestId: randomUUID(),
      }),
    ).toMatchObject({ title: "Historical evidence", projectId: reopened });
    const saved = JSON.parse(await fs.readFile(join(store.root, `${review.id}.json`), "utf8"));
    expect(saved).not.toHaveProperty("projectId");
    expect(saved).not.toHaveProperty("databaseEpoch");
    expect(agents.sessions.every((session) => session.prompts.length === 0)).toBe(true);
  });

  it("rejects a delayed review read when its owner closes and the same path reopens", async () => {
    await prepareRelay();
    const a = await project("a");
    const store = (controller as unknown as { reviews: ReviewStore }).reviews;
    const review = await store.create(null, 0, "A");
    await store.capture(review.id, []);
    const revisionId = store.get(review.id).revisions[0]?.id as string;
    const identity = {
      project: a.path,
      projectId: a.id,
      databaseEpoch: controller.snapshot().databaseEpoch as number,
    };
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = store.withLineStats.bind(store);
    const read = vi.spyOn(store, "withLineStats").mockImplementation(async (...args) => {
      await gate;
      return original(...args);
    });
    const reading = controller.readReview({
      ...identity,
      reviewId: review.id,
      revisionId,
      requestId: randomUUID(),
    });
    const rejected = expect(reading).rejects.toThrow("no longer open");
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    await controller.projectAction({ type: "close", projectId: a.id });
    await controller.open(a.path);
    release();
    await rejected;
  });

  it("publishes a delayed Git check only to its captured selected owner", async () => {
    await prepareRelay();
    const a = await project("a");
    const b = await project("b");
    await controller.projectAction({ type: "select", projectId: a.id });
    const identity = {
      project: a.path,
      projectId: a.id,
      databaseEpoch: controller.snapshot().databaseEpoch as number,
    };
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = vi.spyOn(git, "repoInfo").mockImplementationOnce(async () => {
      await gate;
      throw new Error("Not a Git repository");
    });
    const checking = controller.checkGit(identity);
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    await controller.projectAction({ type: "select", projectId: b.id });
    release();
    expect(await checking).toMatchObject({ status: "not_repository" });
    expect(controller.snapshot().directory).toBe(b.path);
    expect(controller.snapshot().gitReadiness?.status).toBe("ready");
    await controller.projectAction({ type: "select", projectId: a.id });
    expect(controller.snapshot().gitReadiness?.status).toBe("not_repository");
  });

  it("fences file activation and inactive cleanup by project instance and database epoch", async () => {
    await prepareRelay();
    const a = await project("a");
    const epoch = controller.snapshot().databaseEpoch as number;
    const context = {
      project: a.path,
      root: a.path,
      projectId: a.id,
      databaseEpoch: epoch,
      directories: [""],
      preview: null,
    };
    await controller.setFileContext(context);
    expect(controller.snapshot().files?.context.projectId).toBe(a.id);
    await expect(
      controller.setFileContext({ ...context, databaseEpoch: epoch + 1 }),
    ).rejects.toThrow("database changed");
    const b = await project("b");
    const second = { ...context, project: b.path, root: b.path, projectId: b.id };
    await controller.setFileContext(second);
    await expect(controller.setFileContext(context)).rejects.toThrow("inactive");
    await controller.setFileContext({ ...context, active: false });
    expect(controller.snapshot().files?.context.projectId).toBe(b.id);
    await controller.projectAction({ type: "close", projectId: a.id });
    await controller.open(a.path);
    expect(controller.snapshot().projectInstanceId).not.toBe(a.id);
    await expect(controller.setFileContext(context)).rejects.toThrow("no longer open");
    await expect(
      controller.setFileContext({ ...context, projectId: undefined, databaseEpoch: undefined }),
    ).rejects.toThrow("instance");
  });
  it("rejects a pending file context after closing and reopening its identical path", async () => {
    await prepareRelay();
    const a = await project("a");
    const context = {
      project: a.path,
      root: a.path,
      projectId: a.id,
      databaseEpoch: controller.snapshot().databaseEpoch as number,
      directories: [""],
      preview: null,
    };
    type FileValidation = { validateFileRoot(value: typeof context): Promise<void> };
    const implementation = controller as unknown as FileValidation;
    const validate = implementation.validateFileRoot.bind(controller);
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = vi.spyOn(implementation, "validateFileRoot").mockImplementation(async (value) => {
      await blocked;
      await validate(value);
    });
    const pending = controller.setFileContext(context);
    const rejected = expect(pending).rejects.toThrow("no longer open");
    await vi.waitFor(() => expect(read).toHaveBeenCalled());
    await controller.projectAction({ type: "close", projectId: a.id });
    await controller.open(a.path);
    release();
    await rejected;
    expect(controller.snapshot().files).toBeNull();
    read.mockRestore();
  });
  it("rejects file activation when navigation changes during filesystem validation", async () => {
    await prepareRelay();
    const a = await project("a");
    const context = {
      project: a.path,
      root: a.path,
      projectId: a.id,
      databaseEpoch: controller.snapshot().databaseEpoch as number,
      directories: [""],
      preview: null,
    };
    type FileValidation = { validateFileRoot(value: typeof context): Promise<void> };
    const implementation = controller as unknown as FileValidation;
    const validate = implementation.validateFileRoot.bind(controller);
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = vi.spyOn(implementation, "validateFileRoot").mockImplementation(async (value) => {
      await validate(value);
      await blocked;
    });
    try {
      const pending = controller.setFileContext(context);
      const rejected = expect(pending).rejects.toThrow("inactive");
      await vi.waitFor(() => expect(read).toHaveBeenCalled());
      const b = await project("b");
      release();
      await rejected;
      expect(controller.snapshot().directory).toBe(b.path);
      expect(controller.snapshot().files).toBeNull();
      await controller.projectAction({ type: "select", projectId: a.id });
      expect(controller.snapshot().files).toBeNull();
    } finally {
      release();
      read.mockRestore();
    }
  });
  it("captures manual launch identity before navigation and rejects closed or replaced owners", async () => {
    await prepareRelay();
    const a = await project("a");
    const identity = {
      projectId: a.id,
      databaseEpoch: controller.snapshot().databaseEpoch as number,
    };
    const b = await project("b");
    const [id] = await controller.start({ ...request, ...identity });
    await vi.waitFor(() => expect(git.worktrees[0]?.repoDir).toBe(a.path));
    expect(controller.snapshot().directory).toBe(b.path);
    expect(controller.snapshot().runs.some((run) => run.record.id === id)).toBe(false);
    await expect(
      controller.start({ ...request, ...identity, databaseEpoch: identity.databaseEpoch + 1 }),
    ).rejects.toThrow("database changed");
    await controller.projectAction({ type: "close", projectId: a.id });
    await expect(controller.start({ ...request, ...identity })).rejects.toThrow("no longer open");
  });
  async function prepareRelay() {
    await controller.shutdown(true);
    orchestrationProvider = "claude";
    controller = new DesktopController(
      controllerDeps(),
      { XDG_CONFIG_HOME: join(directory, "config"), XDG_STATE_HOME: join(directory, "state") },
      { confirm },
      { openDatabase, preferences, relay: true },
    );
    const adapter: CoreDeps["git"] = git;
    adapter.repoInfo = async (cwd) => ({ topLevel: cwd, commonDir: join(cwd, ".git") });
    await controller.restore();
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
  }

  async function project(name: string) {
    const path = join(directory, name);
    await fs.mkdir(path);
    await controller.open(path);
    const opened = controller
      .snapshot()
      .openProjects?.find((entry) => entry.path === controller.snapshot().directory);
    if (!opened) throw new Error("Project did not open");
    return opened;
  }

  async function newChat(projectId: string) {
    await controller.orchestrationChatAction({ type: "new", projectId });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    const chat = controller.snapshot().chat;
    if (!chat.run) throw new Error("No project chat");
    expect(chat.kind).toBe("project");
    expect(chat.projectId).toBe(projectId);
    return chat;
  }

  async function call(chatId: string, name: string, args: unknown = {}) {
    const chat = controller.snapshot().chats.find((chat) => chat.run?.id === chatId);
    const spec = agents.specs.find((spec) => spec.cwd === chat?.directory);
    const server = spec?.mcpServers?.find((server) => server.name === "code60");
    if (!server || !("env" in server)) throw new Error("No chat gateway");
    const env = Object.fromEntries(server.env?.map(({ name, value }) => [name, value]) ?? []);
    const response = await fetch(String(env.CODE60_MCP_GATEWAY_URL), {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CODE60_MCP_GATEWAY_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name, arguments: args }),
    });
    const body = (await response.json()) as { result: Record<string, unknown>; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Tool failed");
    return body.result;
  }

  it("keeps project chats bound while navigating and routes background events to their owner", async () => {
    await prepareRelay();
    const relayId = controller.snapshot().chat.run?.id;
    const a = await project("a");
    const chatA = await newChat(a.id);
    await controller.orchestrationChatAction({
      type: "send",
      id: chatA.run?.id as string,
      text: "A task",
    });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    const b = await project("b");
    const chatB = await newChat(b.id);
    expect(controller.snapshot().openProjects).toHaveLength(2);
    expect(controller.snapshot().chats.some((chat) => chat.run?.id === chatA.run?.id)).toBe(true);
    const contextA = await call(chatA.run?.id as string, "code60_get_context");
    expect(contextA.project).toBe(a.path);
    agents.script = () => "hang";
    const worker = await call(chatA.run?.id as string, "code60_dispatch_agent", {
      scope: contextA.scope,
      requestId: "background-a",
      prompt: "Only A",
      provider: "claude",
    });
    expect(controller.snapshot().directory).toBe(b.path);
    expect(controller.snapshot().runs.some((run) => run.record.id === worker.runId)).toBe(false);
    const session = agents.sessions.at(-1);
    await vi.waitFor(() => expect(session?.turnActive).toBe(true));
    session?.update({ type: "message", text: "A result while B is selected" });
    await controller.projectAction({ type: "select", projectId: a.id });
    expect(
      controller
        .snapshot()
        .events.some(
          ({ event }) => event.type === "message" && event.text === "A result while B is selected",
        ),
    ).toBe(true);
    expect(controller.snapshot().runs.some((run) => run.record.id === worker.runId)).toBe(true);
    expect(git.worktrees).toHaveLength(1);
    expect(git.worktrees[0]?.repoDir).toBe(a.path);
    await controller.projectAction({ type: "close", projectId: b.id });
    expect(session?.stops).toEqual([]);
    expect(controller.snapshot().chats.some((chat) => chat.run?.id === chatB.run?.id)).toBe(false);
    expect(controller.snapshot().chats.find((chat) => chat.kind === "relay")?.run?.id).toBe(
      relayId,
    );
    expect(agents.sessions[0]?.prompts).toEqual([]);
  });

  it("restores the retained project conversation after visiting an empty project", async () => {
    await prepareRelay();
    const relayId = controller.snapshot().chat.run?.id;
    const a = await project("a");
    const chat = await newChat(a.id);
    await project("empty");
    expect(controller.snapshot().chat.kind).toBe("relay");
    await controller.projectAction({ type: "select", projectId: a.id });
    expect(controller.snapshot().chat.run?.id).toBe(chat.run?.id);
    expect(controller.snapshot().chats.filter((chat) => chat.kind === "project")).toHaveLength(1);
    expect(controller.snapshot().chats.find((chat) => chat.kind === "relay")?.run?.id).toBe(
      relayId,
    );
    expect(agents.sessions[0]?.prompts).toEqual([]);
  });

  it("stops every database-owned runtime while retaining Relay across database replacement", async () => {
    await prepareRelay();
    const relayId = controller.snapshot().chat.run?.id;
    const a = await project("a");
    await newChat(a.id);
    const b = await project("b");
    await newChat(b.id);
    const projectSessions = agents.sessions.slice(1);
    await controller.connect(join(directory, "replacement.sqlite"), true);
    expect(controller.snapshot().openProjects).toEqual([]);
    expect(controller.snapshot().projectInstanceId).toBeNull();
    expect(controller.snapshot().chat.run?.id).toBe(relayId);
    expect(agents.sessions[0]?.stops).toEqual([]);
    expect(projectSessions.every((session) => session.stops.length > 0)).toBe(true);
    expect(() => controller.projectAction({ type: "select", projectId: a.id })).toThrow(
      "no longer open",
    );
  });

  it("refuses project dispatch before a human Send and preserves a failed close for retry", async () => {
    await prepareRelay();
    const a = await project("a");
    const chat = await newChat(a.id);
    const context = await call(chat.run?.id as string, "code60_get_context");
    await expect(
      call(chat.run?.id as string, "code60_dispatch_agent", {
        scope: context.scope,
        requestId: "not-authorized",
        prompt: "Do not execute",
      }),
    ).rejects.toThrow("human task");
    expect(git.worktrees).toEqual([]);
    const shutdown = vi
      .spyOn(controller as unknown as { shutdownBatches(): Promise<void> }, "shutdownBatches")
      .mockRejectedValueOnce(new Error("Could not stop"));
    await expect(controller.projectAction({ type: "close", projectId: a.id })).rejects.toThrow(
      "kept open",
    );
    expect(controller.snapshot().openProjects?.some((project) => project.id === a.id)).toBe(true);
    shutdown.mockRestore();
    await controller.projectAction({ type: "close", projectId: a.id });
    expect(controller.snapshot().openProjects).toEqual([]);
  });

  it("keeps Relay workers on project close and stops them only with explicit folder stop", async () => {
    await prepareRelay();
    const relayId = controller.snapshot().chat.run?.id as string;
    const a = await project("a");
    const b = await project("b");
    await controller.orchestrationChatAction({ type: "send", id: relayId, text: "Work in A" });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    const context = await call(relayId, "code60_get_context");
    agents.script = () => "hang";
    await call(relayId, "code60_dispatch_agent", {
      scope: context.scope,
      requestId: "relay-a",
      cwd: a.path,
      workspaceMode: "direct",
      prompt: "A work",
    });
    await vi.waitFor(() => expect(agents.sessions).toHaveLength(2));
    const worker = agents.sessions[1];
    await vi.waitFor(() => expect(worker?.turnActive).toBe(true));
    await controller.projectAction({ type: "close", projectId: a.id });
    expect(worker?.stops).toEqual([]);
    await controller.open(a.path);
    const reopened = controller.snapshot().openProjects?.find((project) => project.path === a.path);
    expect(reopened?.id).not.toBe(a.id);
    await controller.projectAction({ type: "stop-folder", projectId: reopened?.id as string });
    expect(worker?.stops.length).toBeGreaterThan(0);
    expect(controller.snapshot().openProjects?.some((project) => project.id === b.id)).toBe(true);
    expect(agents.sessions[0]?.stops).toEqual([]);
  });

  it("cancels pending project preparation on Stop all without starting a worker", async () => {
    await prepareRelay();
    await project("a");
    const before = agents.specs.length;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resolve = vi.spyOn(git, "resolveCommit").mockImplementation(async () => {
      await gate;
      return "c0ffee";
    });
    const starting = controller.start({ ...request, prompt: "Must not run" });
    void starting.catch(() => {});
    await vi.waitFor(() => expect(resolve).toHaveBeenCalled());
    const stopping = controller.stopAll();
    release();
    await expect(starting).rejects.toThrow("cancelled");
    await stopping;
    expect(agents.specs).toHaveLength(before);
    resolve.mockRestore();
  });

  it("routes background plan, review, diff and Git requests without selecting their project", async () => {
    await prepareRelay();
    const a = await project("a");
    const chat = await newChat(a.id);
    const plan = (await call(chat.run?.id as string, "code60_create_plan", {
      requestId: "a-plan",
      title: "A plan",
      description: "",
      tasks: [{ text: "Only A" }],
    })) as unknown as Plan;
    Object.assign(git, {
      reviewSnapshot: async () => ({
        files: [
          {
            path: "a.txt",
            oldPath: "a.txt",
            status: "modified",
            original: "A before",
            modified: "A after",
            fingerprint: "A",
          },
        ],
        truncated: false,
      }),
    });
    const [worker] = await controller.start(request);
    await vi.waitFor(() => expect(controller.snapshot().runs[0]?.view?.status).toBe("idle"));
    const identity = {
      project: a.path,
      projectId: a.id,
      databaseEpoch: controller.snapshot().databaseEpoch as number,
    };
    const reviewId = await controller.reviewAction({
      type: "open-run",
      ...identity,
      runId: worker as string,
    });
    await controller.captureReview({ ...identity, reviewId, requestId: randomUUID() });
    const b = await project("b");
    expect(
      (await controller.readPlan({ chatId: chat.run?.id as string, planId: plan.id })).title,
    ).toBe("A plan");
    await controller.planAction({
      type: "dismiss",
      chatId: chat.run?.id as string,
      planId: plan.id,
      revision: plan.revision,
    });
    const review = await controller.readReview({
      ...identity,
      reviewId,
      requestId: randomUUID(),
    });
    const revision = review.revisions.at(-1);
    if (!revision) throw new Error("Missing revision");
    const content = await controller.readReviewFile({
      ...identity,
      reviewId,
      requestId: randomUUID(),
      revisionId: revision.id,
      fileKey: `${worker}:a.txt`,
    });
    expect(content.modified).toBe("A after");
    await controller.reviewAction({ type: "open-run", ...identity, runId: worker as string });
    expect(await controller.taskAction({ type: "status", ...identity, reviewId })).toMatchObject({
      available: false,
    });
    expect(await controller.readDiff({ requestId: randomUUID(), id: worker as string })).toBeTypeOf(
      "string",
    );
    expect((await controller.checkGit(identity)).status).toBe("ready");
    expect(controller.snapshot().directory).toBe(b.path);
    await controller.projectAction({ type: "close", projectId: a.id });
    await expect(
      controller.readPlan({ chatId: chat.run?.id as string, planId: plan.id }),
    ).rejects.toThrow("no longer available");
    await expect(
      controller.readReview({ ...identity, reviewId, requestId: randomUUID() }),
    ).rejects.toThrow("no longer open");
  });
});

describe("desktop orchestration", () => {
  it("does not load or expose database-wide legacy chats under Relay and leaves their files untouched", async () => {
    await setProvider("claude");
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    const id = controller.snapshot().chat.run?.id as string;
    await controller.orchestrationChatAction({ type: "send", id, text: "Legacy source" });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    await controller.shutdown();
    const legacyRoot = join(directory, ".code60_workspace", "chats");
    const originals = await Promise.all(
      (await fs.readdir(legacyRoot)).map(async (name) => ({
        name,
        content: await fs.readFile(join(legacyRoot, name), "utf8"),
      })),
    );
    expect(originals.length).toBeGreaterThan(0);
    const load = vi.spyOn(ChatStore.prototype, "load");
    const before = agents.specs.length;
    controller = new DesktopController(
      controllerDeps(),
      { XDG_CONFIG_HOME: join(directory, "config"), XDG_STATE_HOME: join(directory, "state") },
      { confirm },
      { openDatabase, preferences, relay: true },
    );
    await controller.restore();
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    expect(controller.snapshot().chat.kind).toBe("relay");
    expect(agents.specs).toHaveLength(before + 1);
    expect(load).not.toHaveBeenCalled();
    load.mockRestore();
    expect(controller.snapshot().chats.map((chat) => chat.kind)).toEqual(["relay"]);
    await expect(controller.orchestrationChatAction({ type: "select", id })).rejects.toThrow(
      "no longer current",
    );
    await expect(
      controller.orchestrationChatAction({ type: "send", id, text: "Do not resume" }),
    ).rejects.toThrow("no longer current");
    await expect(controller.orchestrationChatAction({ type: "new" })).rejects.toThrow(
      "Open a project",
    );
    expect(controller.snapshot().chat.kind).toBe("relay");
    expect(agents.specs).toHaveLength(before + 1);
    for (const original of originals)
      expect(await fs.readFile(join(legacyRoot, original.name), "utf8")).toBe(original.content);
  });

  it.each(["stop all", "shutdown"])(
    "attempts every batch when helper cleanup fails during %s",
    async (action) => {
      await start();
      await controller.start(request);
      await vi.waitFor(() => expect(agents.sessions).toHaveLength(2));
      const helper = vi
        .spyOn(
          controller as unknown as { stopMemoryExtraction(): Promise<void> },
          "stopMemoryExtraction",
        )
        .mockRejectedValueOnce(new Error("Helper cleanup failed"));
      try {
        await expect(
          action === "shutdown" ? controller.shutdown() : controller.stopAll(),
        ).rejects.toThrow();
        expect(agents.sessions.every((session) => session.stops.length > 0)).toBe(true);
        expect(controller.active).toBe(false);
      } finally {
        helper.mockRestore();
      }
    },
  );

  it("scrubs connection-test failures before exposing them in a desktop snapshot", async () => {
    await setProvider("claude");
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    agents.startError = new Error(
      `connection failed: api_key=${["synthetic", "credential"].join("-")}`,
    );
    await controller.testOrchestrationProvider();
    expect(controller.snapshot().orchestration.error).toContain("api_key=[REDACTED]");
    expect(JSON.stringify(controller.snapshot())).not.toContain("synthetic-credential");
  });

  it("saves an orchestration provider with fixed allow-all and probes ACP without creating a run", async () => {
    await expect(controller.testOrchestrationProvider()).rejects.toThrow("Select an available");
    await expect(setProvider("missing")).rejects.toThrow("Unavailable provider");
    await setProvider("claude");
    expect(orchestrationProvider).toBe("claude");
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    const probe = agents.specs.length;
    await controller.testOrchestrationProvider();
    expect(controller.snapshot().orchestration).toEqual({
      provider: "claude",
      allowAll: true,
      connection: "connected",
      error: null,
    });
    expect(agents.sessions[probe]?.prompts).toEqual([]);
    expect(agents.sessions[probe]?.stops).toEqual([1000]);
    expect(controller.snapshot().runs).toEqual([]);
    expect(confirm).not.toHaveBeenCalled();
    await setProvider(null);
    expect(controller.snapshot().orchestration.provider).toBeNull();
  });

  it("retains settings on save failure and exposes failed connection tests", async () => {
    await setProvider("claude");
    preferencesFail = true;
    await expect(setProvider("codex")).rejects.toThrow("read-only");
    expect(controller.snapshot().orchestration.provider).toBe("claude");
    agents.startError = new Error("ACP authentication required");
    await controller.testOrchestrationProvider();
    expect(controller.snapshot().orchestration).toMatchObject({
      connection: "failed",
      error: "ACP authentication required",
    });
  });

  it("deduplicates tests, keeps the action queue responsive, and cancels on database changes", async () => {
    await setProvider("claude");
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    agents.startGate = new Promise(() => {});
    const first = controller.testOrchestrationProvider();
    await vi.waitFor(() => expect(controller.snapshot().orchestration.connection).toBe("testing"));
    // The probe reports testing before its agent launch is recorded.
    await vi.waitFor(() => expect(agents.specs).toHaveLength(2));
    const second = controller.testOrchestrationProvider();
    await controller.poll(["config"]);
    expect(agents.specs).toHaveLength(2);
    await controller.connect(join(directory, "second.sqlite"), true);
    await Promise.all([first, second]);
    await vi.waitFor(() => expect(agents.specs).toHaveLength(3));
    expect(controller.snapshot().orchestration).toMatchObject({
      provider: "claude",
      connection: "idle",
      error: null,
    });
  });

  it("restores an unavailable saved provider without silently replacing it", async () => {
    orchestrationProvider = "removed";
    await controller.restore();
    expect(controller.snapshot().orchestration).toMatchObject({
      provider: "removed",
      allowAll: true,
    });
    await expect(controller.testOrchestrationProvider()).rejects.toThrow("Select an available");
  });

  it("stops connection probes on shutdown", async () => {
    await setProvider("claude");
    agents.startGate = new Promise(() => {});
    const test = controller.testOrchestrationProvider();
    await vi.waitFor(() => expect(controller.snapshot().orchestration.connection).toBe("testing"));
    await controller.shutdown();
    await test;
    expect(controller.snapshot().orchestration.connection).toBe("idle");
  });
  it("scopes file reads to the project and listed worktrees, refreshes, and clears on project switches", async () => {
    await controller.open(directory);
    const project = controller.snapshot().directory as string;
    await fs.writeFile(join(project, "preview.txt"), "before");
    const context = { project, root: project, directories: [""], preview: "preview.txt" };
    await controller.setFileContext(context);
    expect(controller.snapshot().files?.preview?.text).toBe("before");
    await fs.writeFile(join(project, "preview.txt"), "after");
    await controller.poll(["files"]);
    expect(controller.snapshot().files?.preview?.text).toBe("after");
    await expect(controller.setFileContext({ ...context, root: "/" })).rejects.toThrow(/root/);
    await expect(controller.setFileContext({ ...context, project: "/other" })).rejects.toThrow(
      /changed/,
    );
    const worktree = join(project, "worker");
    await fs.mkdir(worktree);
    await fs.writeFile(join(worktree, "preview.txt"), "worker");
    vi.spyOn(git, "listWorktrees").mockResolvedValue([
      { path: worktree, branch: "worker", createdAt: null, sizeBytes: null },
    ]);
    await controller.poll(["worktrees"]);
    await controller.setFileContext({ ...context, root: worktree });
    expect(controller.snapshot().files?.preview?.text).toBe("worker");
    await controller.open(worktree);
    expect(controller.snapshot().files).toBeNull();
    await expect(controller.setFileContext(context)).rejects.toThrow(/changed/);
  });

  it("lists the open repository's worktrees and propagates inventory errors", async () => {
    await expect(controller.poll(["worktrees"])).rejects.toThrow(/not available/);
    await controller.open(directory);
    const worktrees = [
      { path: directory, branch: "main", createdAt: null, sizeBytes: 42 },
      { path: "/external/worktree", branch: null, createdAt: null, sizeBytes: null },
    ];
    const list = vi.spyOn(git, "listWorktrees").mockResolvedValue(worktrees);
    await controller.poll(["worktrees"]);
    expect(controller.snapshot().worktrees).toEqual({
      repository: basename(directory),
      worktrees,
    });
    expect(list).toHaveBeenCalledWith(directory, expect.objectContaining({ sizes: false }));
    list.mockRejectedValueOnce(new Error("Cannot list worktrees"));
    await expect(controller.poll(["worktrees"])).rejects.toThrow("Cannot list worktrees");
    // A failed poll keeps the last successful listing and records the error.
    expect(controller.snapshot().worktrees?.worktrees).toEqual(worktrees);
    const state = controller.snapshot().polling.sources.find((s) => s.key === "worktrees");
    expect(state).toMatchObject({ failures: 1, lastError: "Cannot list worktrees" });
    expect(state?.history.map((result) => result.ok)).toEqual([true, false]);
    await controller.open(directory);
    expect(controller.snapshot().worktrees).toBeNull();
  });

  it("persists only polling overrides and restores them on launch", async () => {
    let saved: PollSettingsPatch = {};
    preferences.setPolling = async (settings) => {
      saved = settings;
    };
    preferences.polling = async () => saved;
    try {
      const history = { intervalMs: 10000, idleIntervalMs: 60000 };
      await controller.setPollSettings({ history });
      expect(saved).toEqual({ history });
      const source = () => controller.snapshot().polling.sources.find((s) => s.key === "history");
      expect(source()?.setting).toEqual(history);
      await controller.setPollSettings({ history: null });
      expect(saved).toEqual({});
      expect(source()?.setting).toEqual({ intervalMs: 5000, idleIntervalMs: 30000 });
      saved = { history };
      await controller.restore();
      expect(source()?.setting).toEqual(history);
      controller.setPollingPaused(true);
      expect(controller.snapshot().polling.paused).toBe(true);
    } finally {
      delete preferences.setPolling;
      delete preferences.polling;
    }
  });

  it("returns an empty inventory for a non-Git project without scanning", async () => {
    git.repoInfo = async () => {
      throw new Error("no repo");
    };
    await controller.open(directory);
    const list = vi.spyOn(git, "listWorktrees");
    await controller.poll(["worktrees"]);
    expect(controller.snapshot().worktrees).toEqual({ repository: null, worktrees: [] });
    expect(list).not.toHaveBeenCalled();
  });

  it("manages configurations across projects but not databases, without storing prompts", async () => {
    await controller.saveConfiguration({
      name: " Team ",
      settings: { ...request, agents: ["claude", "codex"] },
    });
    const entry = controller.snapshot().configurations[0] as RunConfiguration;
    expect(entry).toMatchObject({
      name: "Team",
      uses: 0,
      lastUsed: null,
      settings: { parallel: "4", turnTimeout: "30m" },
    });
    await controller.open(directory);
    const ids = await controller.start({
      ...entry.settings,
      configurationId: entry.id,
      prompt: "private task",
      parallel: "1",
    });
    expect(ids).toHaveLength(2);
    expect(controller.snapshot().configurations[0]).toMatchObject({
      uses: 1,
      lastUsed: expect.any(String),
    });
    await controller.saveConfiguration({ name: "New settings", launchId: ids[0] as string });
    expect(controller.snapshot().configurations[1]).toMatchObject({
      uses: 1,
      settings: { parallel: "1" },
    });
    expect(JSON.stringify(controller.snapshot().configurations)).not.toContain("private task");
    expect(agents.sessions.length).toBeLessThanOrEqual(1);
    await expect(
      controller.saveConfiguration({ name: "Again", launchId: ids[0] as string }),
    ).rejects.toThrow(/already saved/);
    await expect(controller.saveConfiguration({ name: "TEAM", settings: request })).rejects.toThrow(
      /already exists/,
    );
    await controller.saveConfiguration({ id: entry.id, name: "Renamed", settings: request });
    expect(controller.snapshot().configurations[1]?.uses).toBe(1);
    await controller.stopAll();
    const other = join(directory, "other-config-project");
    await fs.mkdir(other);
    await controller.open(other);
    expect(controller.snapshot().configurations).toHaveLength(2);
    confirm.mockResolvedValueOnce(false);
    expect(await controller.deleteConfiguration(entry.id)).toBe(false);
    expect(await controller.deleteConfiguration(entry.id)).toBe(true);
    expect(controller.snapshot().configurations).toHaveLength(1);
    await controller.connect(join(directory, "second.sqlite"), true);
    expect(controller.snapshot().configurations).toEqual([]);
    await expect(controller.start({ ...request, configurationId: entry.id })).rejects.toThrow();
  });

  it("does not count Git-blocked launches and keeps saved configurations usable after setup", async () => {
    const first = await start();
    await controller.saveConfiguration({ name: "Saved", launchId: first });
    const entry = controller.snapshot().configurations[0] as RunConfiguration;
    await controller.action({ type: "finish", id: first });
    await vi.waitFor(() => expect(controller.active).toBe(false));
    const ready = git.repoInfo;
    git.repoInfo = async () => {
      throw new Error("no repo");
    };
    await controller.open(directory);
    await expect(
      controller.start({ ...entry.settings, configurationId: entry.id }),
    ).rejects.toThrow("Set up Git");
    expect(controller.snapshot().configurations[0]?.uses).toBe(1);
    expect(confirm).not.toHaveBeenCalled();
    git.repoInfo = ready;
    await controller.start({ ...entry.settings, configurationId: entry.id });
    expect(controller.snapshot().configurations[0]?.uses).toBe(2);
  });

  it("keeps accepted launches running when usage or saving fails and permits save retry", async () => {
    await controller.saveConfiguration({ name: "Team", settings: request });
    const entry = controller.snapshot().configurations[0] as RunConfiguration;
    await controller.open(directory);
    const data = databases.get(join(directory, "first.sqlite"));
    if (data) data.failWrites = true;
    const [id] = await controller.start({ ...request, configurationId: entry.id });
    expect(id).toBeTruthy();
    expect(controller.snapshot().warnings.join(" ")).toContain("Agents started");
    await expect(
      controller.saveConfiguration({ name: "Saved", launchId: id as string }),
    ).rejects.toThrow(/disk is full/);
    if (data) data.failWrites = false;
    await controller.saveConfiguration({ name: "Saved", launchId: id as string });
    expect(controller.snapshot().configurations).toHaveLength(2);
    await vi.waitFor(() => expect(agents.sessions).toHaveLength(1));
    await expect(
      controller.saveConfiguration({ name: "Bad", settings: { ...request, agents: ["missing"] } }),
    ).rejects.toThrow(/not enabled/);
    await expect(controller.start({ ...request, configurationId: "unknown" })).rejects.toThrow(
      /Unknown run configuration/,
    );
    expect(controller.snapshot().runs).toHaveLength(1);
  });
  it("starts without a prompt, streams follow-ups, finishes, and loads recorded history", async () => {
    const id = await start();
    agents.script = (_text, session) => {
      session.update({ type: "message", text: "hello" });
      return "end_turn";
    };
    // Sessions retain their script; send events explicitly to simulate streaming.
    agents.sessions[0]?.update({ type: "message", text: "hello" });
    await controller.action({ type: "reply", id, text: "first task" });
    await vi.waitFor(() => expect(agents.sessions[0]?.prompts).toEqual(["first task"]));
    await vi.waitFor(() => expect(controller.snapshot().runs[0]?.view?.status).toBe("idle"));
    expect(controller.snapshot().events.some((entry) => entry.event.type === "message")).toBe(true);
    await controller.action({ type: "finish", id });
    await vi.waitFor(() => expect(controller.active).toBe(false));
    const events = await controller.action({ type: "events", id });
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "prompt", text: "first task" })]),
    );
    expect(await controller.action({ type: "diff", id })).toMatch(/diff --git/);
    await controller.open(directory);
    expect(controller.snapshot().runs[0]?.record.status).toBe("finished");
  });

  it("starts independent overlapping batches and refuses switches until both end", async () => {
    const first = await start("earlier task");
    agents.sessions[0]?.update({ type: "message", text: "earlier transcript" });
    const events = controller.snapshot().events;
    const [second] = await controller.start(request);
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    await vi.waitFor(() => expect(agents.sessions).toHaveLength(2));
    await vi.waitFor(() =>
      expect(controller.snapshot().runs.find((run) => run.record.id === second)?.view?.status).toBe(
        "idle",
      ),
    );
    expect(agents.sessions[1]?.prompts).toEqual([]);
    expect(git.worktrees[1]?.base).toBe(git.worktrees[0]?.base);
    expect(git.worktrees[1]?.path).not.toBe(git.worktrees[0]?.path);
    expect(controller.snapshot().events).toEqual(expect.arrayContaining(events));
    await controller.action({ type: "reply", id: second as string, text: "new task" });
    await vi.waitFor(() => expect(agents.sessions[1]?.prompts).toEqual(["new task"]));
    expect(agents.sessions[0]?.prompts).toEqual(["earlier task"]);
    await controller.action({ type: "finish", id: first });
    await vi.waitFor(() => expect(agents.sessions[0]?.stops.length).toBeGreaterThan(0));
    await vi.waitFor(async () => {
      await controller.poll(["history", "config", "configurations"]);
      expect(controller.snapshot().runs.find((run) => run.record.id === first)?.record.status).toBe(
        "finished",
      );
    });
    expect(controller.active).toBe(true);
    await expect(controller.open(join(directory, "other"))).rejects.toThrow(/switching folders/);
    await expect(controller.connect(join(directory, "second.sqlite"), true)).rejects.toThrow(
      /switching databases/,
    );
    await vi.waitFor(() =>
      expect(controller.snapshot().runs.find((run) => run.record.id === second)?.view?.status).toBe(
        "idle",
      ),
    );
    await controller.action({ type: "finish", id: second as string });
    await vi.waitFor(() => expect(controller.active).toBe(false));
    await controller.poll(["history", "config", "configurations"]);
    expect(controller.snapshot().runs.every((run) => run.record.status === "finished")).toBe(true);
    expect(controller.snapshot().events).toEqual(expect.arrayContaining(events));
  });

  it("keeps parallel limits per batch, including queued sessions", async () => {
    await controller.open(directory);
    const first = await controller.start({
      ...request,
      agents: ["claude", "claude"],
      parallel: "1",
    });
    const second = await controller.start({
      ...request,
      agents: ["claude", "claude"],
      parallel: "1",
    });
    await vi.waitFor(() => expect(agents.sessions).toHaveLength(2));
    const status = (id: string) =>
      controller.snapshot().runs.find((run) => run.record.id === id)?.view?.status;
    await vi.waitFor(() => expect(first.map(status)).toEqual(["idle", "queued"]));
    await vi.waitFor(() => expect(second.map(status)).toEqual(["idle", "queued"]));
    await controller.action({ type: "finish", id: first[0] as string });
    await vi.waitFor(() => expect(status(first[1] as string)).toBe("idle"));
    expect(status(second[1] as string)).toBe("queued");
    await controller.stopAll();
    expect(controller.active).toBe(false);
    expect(agents.sessions.every((session) => session.stops.length > 0)).toBe(true);
    expect(agents.sessions).toHaveLength(3);
  });

  it("serializes delayed completion reads with new starts and refreshes", async () => {
    const first = await start();
    const [second] = await controller.start(request);
    await vi.waitFor(() => expect(agents.sessions).toHaveLength(2));
    let release!: () => void;
    let reading = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    listGate = async () => {
      listGate = undefined;
      reading = true;
      await gate;
    };
    await controller.action({ type: "finish", id: first });
    await vi.waitFor(() => expect(reading).toBe(true));
    const thirdStart = controller.start(request);
    const refresh = controller.poll(["history", "config", "configurations"]);
    expect(controller.active).toBe(true);
    expect(agents.sessions).toHaveLength(2);
    release();
    const [third] = await thirdStart;
    await refresh;
    expect(controller.snapshot().runs.map((run) => run.record.id)).toEqual(
      expect.arrayContaining([first, second, third]),
    );
    expect(controller.snapshot().liveIds).toEqual([second, third]);
    expect(controller.active).toBe(true);
    await controller.stopAll();
    await controller.open(directory);
    expect(controller.snapshot().liveIds).toEqual([]);
    expect(controller.snapshot().runs).toHaveLength(3);
    expect(controller.active).toBe(false);
  });

  it("keeps earlier sessions usable when a later batch fails independently", async () => {
    const first = await start();
    agents.startError = new Error("cannot start second agent");
    const [second] = await controller.start(request);
    await vi.waitFor(() =>
      expect(
        controller.snapshot().runs.find((run) => run.record.id === second)?.record.status,
      ).toBe("failed"),
    );
    // The failed status is published before its record is saved and the batch settles;
    // only a history refresh after that drops the batch from the live set.
    await vi.waitFor(async () => {
      await controller.poll(["history", "config", "configurations"]);
      expect(controller.snapshot().liveIds).toEqual([first]);
    });
    expect(controller.active).toBe(true);
    await controller.action({ type: "reply", id: first, text: "unaffected" });
    await vi.waitFor(() => expect(agents.sessions[0]?.prompts).toEqual(["unaffected"]));
  });

  it("routes approvals and cancellation across running and waiting batches", async () => {
    agents.script = () => "hang";
    const first = await start();
    await controller.action({ type: "reply", id: first, text: "first" });
    const permission = { toolCallId: "x", title: "command", kind: "execute" } as const;
    const firstAnswer = agents.sessions[0]?.requestPermission(permission);
    await vi.waitFor(() => expect(controller.snapshot().runs[0]?.view?.status).toBe("waiting"));
    const [second] = await controller.start({ ...request, prompt: "second" });
    await vi.waitFor(() => expect(agents.sessions[1]?.turnActive).toBe(true));
    const secondAnswer = agents.sessions[1]?.requestPermission(permission);
    await vi.waitFor(() =>
      expect(
        controller.snapshot().runs.filter((run) => run.view?.pending.length === 1),
      ).toHaveLength(2),
    );
    for (const [id, answer] of [
      [second, "deny"],
      [first, "allow"],
    ] as const) {
      const pending = controller.snapshot().runs.find((run) => run.record.id === id)?.view
        ?.pending[0];
      await controller.action({ type: "permission", id: pending?.id as string, answer });
      await expect(
        controller.action({ type: "permission", id: pending?.id as string, answer }),
      ).rejects.toThrow(/no longer pending/);
    }
    expect(await firstAnswer).toBe("allow");
    expect(await secondAnswer).toBe("deny");
    await controller.action({ type: "cancel", id: first });
    await vi.waitFor(() => expect(agents.sessions[0]?.cancels).toBe(1));
    expect(agents.sessions[1]?.cancels).toBe(0);
    expect(agents.sessions[1]?.turnActive).toBe(true);
    await controller.stopAll();
    expect(controller.active).toBe(false);
    expect(agents.sessions.every((session) => session.stops.length > 0)).toBe(true);
  });

  it("rejects invalid starts without changing live sessions or transcripts", async () => {
    const id = await start();
    agents.sessions[0]?.update({ type: "message", text: "keep me" });
    const events = controller.snapshot().events;
    await expect(controller.start({ ...request, agents: ["unknown"] })).rejects.toThrow(
      /unknown agent/,
    );
    expect(controller.snapshot().liveIds).toEqual([id]);
    expect(controller.snapshot().events).toEqual(events);
    await controller.action({ type: "reply", id, text: "still usable" });
    await vi.waitFor(() => expect(agents.sessions[0]?.prompts).toEqual(["still usable"]));
    expect(agents.sessions).toHaveLength(1);
  });

  it.each([false, true])("shuts down every batch (force=%s)", async (force) => {
    await start();
    await controller.start(request);
    await vi.waitFor(() => expect(agents.sessions).toHaveLength(2));
    await controller.shutdown(force);
    expect(controller.active).toBe(false);
    expect(agents.sessions.every((session) => session.stops.length > 0)).toBe(true);
    if (force) expect(agents.sessions.every((session) => session.stops.includes(0))).toBe(true);
  });

  it("escalates a pending graceful shutdown for every batch", async () => {
    await start();
    await controller.start(request);
    await vi.waitFor(() => expect(agents.sessions).toHaveLength(2));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (const session of agents.sessions) {
      const stop = session.stop.bind(session);
      vi.spyOn(session, "stop").mockImplementation(async (grace) => {
        if (grace !== 0) await gate;
        else release();
        await stop(grace);
      });
    }
    const graceful = controller.shutdown();
    await vi.waitFor(() =>
      expect(
        agents.sessions.every((session) => vi.mocked(session.stop).mock.calls.length > 0),
      ).toBe(true),
    );
    await controller.shutdown(true);
    await graceful;
    expect(agents.sessions.every((session) => session.stops.includes(0))).toBe(true);
  });

  it("blocks follow-ups to legacy unisolated runs even when Git is ready and retains stop controls", async () => {
    const id = await start();
    const workspace = await openWorkspace(controllerDeps(), directory, {
      XDG_STATE_HOME: join(directory, "state"),
    });
    // The live status changes before its atomic save. Wait before replacing the record
    // with a legacy fixture, otherwise the pending save can overwrite our fixture.
    await vi.waitFor(async () => expect((await workspace.store.read(id)).status).toBe("idle"));
    await workspace.store.save({ ...(await workspace.store.read(id)), base: null, branch: null });
    await expect(controller.action({ type: "reply", id, text: "more work" })).rejects.toThrow(
      "No baseline",
    );
    expect(agents.sessions[0]?.prompts).toEqual([]);
    await controller.action({ type: "finish", id });
    await vi.waitFor(() => expect(controller.active).toBe(false));
    await workspace.store.save({ ...(await workspace.store.read(id)), base: null, branch: null });
    await expect(controller.action({ type: "continue", id, text: "resume" })).rejects.toThrow(
      "No baseline",
    );
    expect(agents.specs).toHaveLength(1);
  });

  it("answers only pending permissions and rejects stale approval clicks", async () => {
    agents.script = () => "hang";
    const id = await start();
    await controller.action({ type: "reply", id, text: "go" });
    const answer = agents.sessions[0]?.requestPermission({
      toolCallId: "x",
      title: "command",
      kind: "execute",
    });
    await vi.waitFor(() => expect(controller.snapshot().runs[0]?.view?.pending).toHaveLength(1));
    const permissionId = controller.snapshot().runs[0]?.view?.pending[0]?.id as string;
    await controller.action({ type: "permission", id: permissionId, answer: "allow" });
    expect(await answer).toBe("allow");
    await expect(
      controller.action({ type: "permission", id: permissionId, answer: "allow" }),
    ).rejects.toThrow(/no longer pending/);
    expect(id).toBeTruthy();
  });

  it("requires Git before desktop launches without offering an unisolated fallback", async () => {
    git.repoInfo = async () => {
      throw new Error("no repo");
    };
    await controller.open(directory);
    await expect(controller.start({ ...request, parallel: "2" })).rejects.toThrow("Set up Git");
    expect(confirm).not.toHaveBeenCalled();
    expect(agents.sessions).toHaveLength(0);
    expect(controller.snapshot().runs).toEqual([]);
  });

  it("confirms changed files before discard and keeps the worktree on denial", async () => {
    const id = await start("go");
    await controller.action({ type: "finish", id });
    await vi.waitFor(() => expect(controller.active).toBe(false));
    git.files = [{ path: "hello.txt", status: "untracked" }];
    confirm.mockResolvedValue(false);
    await controller.action({ type: "discard", id });
    expect(confirm).toHaveBeenCalledWith(
      "Discard this worktree?",
      expect.stringContaining("hello.txt"),
    );
    expect(git.removed).toEqual([]);
    confirm.mockResolvedValue(true);
    await controller.action({ type: "discard", id });
    expect(git.removed).toHaveLength(1);
    expect(controller.snapshot().runs[0]?.record.discardedAt).toBeDefined();
  });

  it("rejects actions on a run from another workspace", async () => {
    const id = await start();
    await controller.stopAll();
    git.repoInfo = async () => ({
      topLevel: join(directory, "other"),
      commonDir: join(directory, "other", ".git"),
    });
    await fs.mkdir(join(directory, "other"));
    await controller.open(join(directory, "other"));
    await expect(controller.action({ type: "diff", id })).rejects.toThrow(/Unknown run/);
  });

  it("sends batched updates and stops idle agents on shutdown", async () => {
    const updates: number[] = [];
    const previous: (number | undefined)[] = [];
    controller.subscribe((snapshot) => {
      updates.push(snapshot.revision);
      previous.push(snapshot.previousRevision);
    });
    await start();
    await vi.waitFor(() => expect(updates.length).toBeGreaterThan(0));
    await controller.poll(["config"]);
    await vi.waitFor(() => expect(updates.length).toBeGreaterThan(1));
    expect(previous.slice(1)).toEqual(updates.slice(0, -1));
    expect(controller.snapshot().previousRevision).toBeUndefined();
    await controller.shutdown();
    expect(agents.sessions[0]?.stops.length).toBeGreaterThan(0);
    expect(controller.active).toBe(false);
    await expect(controller.start(request)).rejects.toThrow(/stopping/);
  });
});

describe("prompt templates", () => {
  const state = (id: string) => controller.snapshot().prompts.find((entry) => entry.id === id);

  it("resolves complete clause sets from the database, config, and defaults", async () => {
    const original = DEFAULT_PROMPT_TEMPLATES.operatingContract;
    const configured = { ...original, planning: "Configured planning." };
    await fs.mkdir(join(directory, "config", "code60"), { recursive: true });
    await fs.writeFile(
      join(directory, "config", "code60", "config.json"),
      JSON.stringify({ prompts: { operatingContract: configured } }),
    );
    await controller.poll(["config"]);
    expect(state("operatingContract")).toMatchObject({
      source: "config",
      template: configured,
      fallback: configured,
    });
    const edited = { ...configured, role: "Edited role.", planning: "Edited planning." };
    await controller.savePromptTemplate({ id: "operatingContract", template: edited });
    expect(state("operatingContract")).toMatchObject({ source: "database", template: edited });
    await expect(
      controller.savePromptTemplate({
        id: "operatingContract",
        template: { ...edited, role: "Not saved.", planning: "" },
      }),
    ).rejects.toThrow();
    expect(state("operatingContract")?.template).toEqual(edited);
    confirm.mockResolvedValueOnce(false);
    await expect(controller.resetPromptTemplate("operatingContract")).resolves.toBe(false);
    expect(state("operatingContract")?.template).toEqual(edited);
    await controller.resetPromptTemplate("operatingContract");
    expect(state("operatingContract")).toMatchObject({ source: "config", template: configured });
    expect(original.planning).not.toBe(configured.planning);
  });

  it("keeps skipped-template warnings when switching databases", async () => {
    const open = openDatabase.getMockImplementation();
    if (!open) throw new Error("Missing database fixture");
    openDatabase.mockImplementationOnce((path, create) => ({
      ...open(path, create),
      promptTemplates: () => ({
        templates: {},
        skipped: ["Ignored a saved prompt template with an unknown ID"],
      }),
    }));
    await controller.connect(join(directory, "invalid.sqlite"), true);
    expect(controller.snapshot().warnings).toContain(
      "Ignored a saved prompt template with an unknown ID",
    );
  });

  it("layers database edits over config.json over built-in templates", async () => {
    expect(state("handoffTurn")).toMatchObject({ source: "built-in", fallbackSource: "built-in" });
    await fs.mkdir(join(directory, "config", "code60"), { recursive: true });
    await fs.writeFile(
      join(directory, "config", "code60", "config.json"),
      JSON.stringify({ prompts: { handoffTurn: "Config {{message}}" } }),
    );
    await controller.poll(["config"]);
    expect(state("handoffTurn")).toMatchObject({
      template: "Config {{message}}",
      source: "config",
      fallbackSource: "config",
    });

    await controller.savePromptTemplate({ id: "handoffTurn", template: "Edit {{message}}" });
    expect(state("handoffTurn")).toMatchObject({
      template: "Edit {{message}}",
      source: "database",
      fallback: "Config {{message}}",
    });
    expect(state("handoffSummary")?.source).toBe("built-in");

    confirm.mockResolvedValueOnce(false);
    await expect(controller.resetPromptTemplate("handoffTurn")).resolves.toBe(false);
    expect(state("handoffTurn")?.source).toBe("database");
    await expect(controller.resetPromptTemplate("handoffTurn")).resolves.toBe(true);
    expect(confirm).toHaveBeenLastCalledWith(
      "Reset prompt template?",
      expect.stringContaining("the template from config.json"),
    );
    expect(state("handoffTurn")).toMatchObject({
      template: "Config {{message}}",
      source: "config",
    });
  });

  it("validates edits and keeps them with their database", async () => {
    await expect(
      controller.savePromptTemplate({ id: "handoffTurn", template: "{{summary}}" }),
    ).rejects.toThrow(/must include/);
    await expect(
      controller.savePromptTemplate({ id: "nope", template: "x" } as never),
    ).rejects.toThrow(/Unknown prompt template/);
    await controller.savePromptTemplate({ id: "handoffSummary", template: "S {{status}}" });
    await controller.connect(join(directory, "second.sqlite"), true);
    expect(state("handoffSummary")?.source).toBe("built-in");
    await controller.connect(join(directory, "first.sqlite"), false);
    expect(state("handoffSummary")).toMatchObject({ template: "S {{status}}", source: "database" });
  });
});

describe("project database", () => {
  it("requires a database before opening a project", async () => {
    const fresh = new DesktopController(
      controllerDeps(),
      { XDG_STATE_HOME: join(directory, "state") },
      { confirm },
      { openDatabase, preferences },
    );
    await expect(fresh.open(directory)).rejects.toThrow(/Connect to a database/);
    await fresh.shutdown(true);
  });

  it("records canonical paths once, newest first, and reopens recorded projects", async () => {
    const other = join(directory, "other");
    await fs.mkdir(other);
    await controller.open(directory);
    await controller.open(other);
    await controller.open(`${directory}/./`);
    const real = await fs.realpath(directory);
    expect(controller.snapshot().projects.map((project) => project.path)).toEqual([
      real,
      await fs.realpath(other),
    ]);
    await controller.openProject(await fs.realpath(other));
    expect(controller.snapshot().directory).toBe(await fs.realpath(other));
    await expect(controller.openProject("/not/recorded")).rejects.toThrow(/not in the database/);
  });

  it("removes one project or, after confirmation, the whole history", async () => {
    const other = join(directory, "other");
    await fs.mkdir(other);
    await controller.open(directory);
    await controller.open(other);
    const real = await fs.realpath(directory);
    await controller.removeProject(await fs.realpath(other));
    expect(controller.snapshot().projects.map((project) => project.path)).toEqual([real]);
    expect(controller.snapshot().directory).toBe(await fs.realpath(other));
    await expect(controller.removeProject("/not/recorded")).rejects.toThrow(/not in the database/);
    confirm.mockResolvedValueOnce(false);
    expect(await controller.clearProjects()).toBe(false);
    expect(controller.snapshot().projects).toHaveLength(1);
    expect(await controller.clearProjects()).toBe(true);
    expect(confirm).toHaveBeenLastCalledWith(
      "Clear project history?",
      expect.stringContaining("not affected"),
    );
    expect(controller.snapshot().projects).toEqual([]);
    await expect(fs.stat(real)).resolves.toBeDefined();
  });

  it("keeps history for a missing folder and reports it", async () => {
    const gone = join(directory, "gone");
    await fs.mkdir(gone);
    await controller.open(gone);
    const real = await fs.realpath(gone);
    await fs.rm(gone, { recursive: true });
    await expect(controller.openProject(real)).rejects.toThrow(/not available/);
    expect(controller.snapshot().projects).toHaveLength(1);
  });

  it("keeps each database's history separate and clears the workspace on switch", async () => {
    await controller.open(directory);
    await controller.connect(join(directory, "second.sqlite"), true);
    expect(controller.snapshot()).toMatchObject({
      database: join(directory, "second.sqlite"),
      directory: null,
      projects: [],
      runs: [],
    });
    expect(stored).toBe(join(directory, "second.sqlite"));
    await controller.connect(join(directory, "first.sqlite"), false);
    expect(controller.snapshot().projects).toHaveLength(1);
  });

  it("keeps the current connection when another database cannot be used", async () => {
    await controller.open(directory);
    await expect(controller.connect(join(directory, "missing.sqlite"), false)).rejects.toThrow(
      /not found/,
    );
    preferencesFail = true;
    await expect(controller.connect(join(directory, "new.sqlite"), true)).rejects.toThrow(
      /remember/,
    );
    expect(controller.snapshot()).toMatchObject({
      database: join(directory, "first.sqlite"),
      directory: await realOf(directory),
    });
    expect(stored).toBe(join(directory, "first.sqlite"));
  });

  it("refuses to switch databases while runs are active", async () => {
    await start();
    await expect(controller.connect(join(directory, "second.sqlite"), true)).rejects.toThrow(
      /switching databases/,
    );
  });

  it("opens the project even when its history cannot be saved", async () => {
    const data = databases.get(join(directory, "first.sqlite"));
    if (data) data.failWrites = true;
    await controller.open(directory);
    expect(controller.snapshot().directory).toBe(await realOf(directory));
    expect(controller.snapshot().warnings[0]).toMatch(/disk is full/);
  });

  it("reconnects on launch and reports a saved database that is gone", async () => {
    await controller.open(directory);
    const restart = () =>
      new DesktopController(controllerDeps(), {}, { confirm }, { openDatabase, preferences });
    const again = restart();
    await again.restore();
    expect(again.snapshot()).toMatchObject({
      database: join(directory, "first.sqlite"),
      databaseError: null,
      projects: [{ path: await realOf(directory) }],
    });
    await again.shutdown(true);
    databases.clear();
    const missing = restart();
    await missing.restore();
    expect(missing.snapshot().database).toBeNull();
    expect(missing.snapshot().databaseError).toMatch(/not found/);
    expect(databases.size).toBe(0);
    await missing.shutdown(true);
  });
});

describe("app-wide orchestration chat", () => {
  it("applies and clears trusted tactics per chat without dispatch and composes only on Send", async () => {
    await setProvider("claude");
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    const first = controller.snapshot().chat.run?.id as string;
    const before = agents.specs.length;
    const apply = (tactic: string | null, id = first, project: string | null = null) =>
      controller.orchestrationChatAction({ type: "set-tactic", id, project, tactic });
    await apply("independent-review");
    expect(controller.snapshot().chat.tactic).toBe("independent-review");
    expect(agents.specs).toHaveLength(before);
    expect(agents.sessions[0]?.prompts).toEqual([]);
    await expect(apply("missing")).rejects.toThrow("unavailable");
    await expect(apply("diagnose-a-bug", first, "/stale")).rejects.toThrow("project changed");
    await controller.orchestrationChatAction({ type: "new" });
    const second = controller.snapshot().chat.run?.id as string;
    expect(controller.snapshot().chat.tactic).toBeUndefined();
    await expect(apply("diagnose-a-bug")).rejects.toThrow("chat or project changed");
    await controller.orchestrationChatAction({ type: "select", id: first });
    await controller.orchestrationChatAction({
      type: "send",
      id: first,
      text: "/plan Review the changes",
      command: "plan",
    });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    expect(agents.sessions[0]?.prompts[0]).toContain("Tactic: Independent review");
    expect(agents.sessions[0]?.prompts[0]).toContain("Command /plan: Make a plan");
    expect(
      controller
        .snapshot()
        .chat.events.some(
          ({ event }) => event.type === "prompt" && event.text === "/plan Review the changes",
        ),
    ).toBe(true);
    await apply(null);
    expect(agents.sessions[0]?.prompts).toHaveLength(1);
    await controller.orchestrationChatAction({ type: "send", id: first, text: "Ordinary request" });
    await vi.waitFor(() => expect(agents.sessions[0]?.prompts).toHaveLength(2));
    expect(agents.sessions[0]?.prompts[1]).toContain("No earlier task's tactic applies");
    expect(
      controller.snapshot().chats.find((chat) => chat.run?.id === second)?.tactic,
    ).toBeUndefined();
  });

  it("rolls back failed tactic saves without sending and leaves unavailable saved IDs actionable", async () => {
    await setProvider("claude");
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    const id = controller.snapshot().chat.run?.id as string;
    const save = vi
      .spyOn(ChatStore.prototype, "save")
      .mockRejectedValueOnce(new Error("disk full"));
    try {
      await expect(
        controller.orchestrationChatAction({
          type: "set-tactic",
          id,
          project: null,
          tactic: "diagnose-a-bug",
        }),
      ).rejects.toThrow("disk full");
      expect(controller.snapshot().chat.tactic).toBeUndefined();
      expect(agents.sessions[0]?.prompts).toEqual([]);
    } finally {
      save.mockRestore();
    }
    const store = new ChatStore(join(directory, ".code60_workspace"));
    const saved = (await store.load()).chats[0];
    if (!saved) throw new Error("Missing saved chat");
    await controller.shutdown(true);
    await store.save({ ...saved, tactic: "retired-tactic" });
    agents = new FakeAgents();
    controller = new DesktopController(
      controllerDeps(),
      { XDG_CONFIG_HOME: join(directory, "config"), XDG_STATE_HOME: join(directory, "state") },
      { confirm },
      { openDatabase, preferences },
    );
    await controller.restore();
    expect(controller.snapshot().chat.tactic).toBe("retired-tactic");
    expect(agents.specs).toHaveLength(0);
    await expect(
      controller.orchestrationChatAction({
        type: "send",
        id,
        text: "Do not silently ignore a missing tactic",
      }),
    ).rejects.toThrow("Replace or clear");
    await controller.orchestrationChatAction({
      type: "set-tactic",
      id,
      project: null,
      tactic: null,
    });
    expect(controller.snapshot().chat.tactic).toBeNull();
    expect(agents.specs).toHaveLength(0);
  });

  it.each([false, true])(
    "restores stopped chat context without execution and explicitly continues the frozen task (handoff=%s)",
    async (handoff) => {
      agents.script = () => "end_turn";
      await setProvider("claude");
      await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
      const id = controller.snapshot().chat.run?.id as string;
      await controller.orchestrationChatAction({
        type: "set-tactic",
        id,
        project: null,
        tactic: "independent-review",
      });
      await controller.orchestrationChatAction({
        type: "send",
        id,
        text: "Review original changes",
      });
      await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
      const taskId = controller.snapshot().chat.taskId as string;
      await controller.orchestrationChatAction({
        type: "set-tactic",
        id,
        project: null,
        tactic: "explore-the-codebase",
      });
      await controller.orchestrationChatAction({ type: "rename", id, title: "Saved review" });
      await controller.shutdown(true);
      agents = new FakeAgents(() => "end_turn");
      agents.restoreUnavailable = handoff;
      controller = new DesktopController(
        controllerDeps(),
        { XDG_CONFIG_HOME: join(directory, "config"), XDG_STATE_HOME: join(directory, "state") },
        { confirm },
        { openDatabase, preferences },
      );
      await controller.restore();
      expect(controller.snapshot().chat).toMatchObject({
        title: "Saved review",
        tactic: "explore-the-codebase",
        restored: true,
        taskId,
        run: { id },
        workers: [],
        updates: { paused: true, pending: 0 },
      });
      expect(agents.specs).toHaveLength(0);
      expect(agents.restores).toHaveLength(0);
      await controller.orchestrationChatAction({ type: "continue-task", id, taskId });
      await vi.waitFor(() => expect(agents.sessions[0]?.prompts).toHaveLength(1));
      expect(agents.sessions[0]?.prompts[0]).toContain("Tactic: Independent review");
      expect(agents.sessions[0]?.prompts[0]).not.toContain("Tactic: Explore the codebase");
      expect(agents.sessions[0]?.prompts[0]).toContain("Code60's orchestration assistant");
      expect(controller.snapshot().chat.tactic).toBe("explore-the-codebase");
      await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
      await controller.orchestrationChatAction({
        type: "send",
        id,
        text: "A new exploration request",
      });
      await vi.waitFor(() => expect(agents.sessions[0]?.prompts).toHaveLength(2));
      expect(agents.sessions[0]?.prompts[1]).toContain("Tactic: Explore the codebase");
    },
  );

  async function ready() {
    await setProvider("claude");
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    return controller.snapshot().chat.run?.id as string;
  }

  it.each([
    "command",
    "project",
    "live owner",
    "missing history",
    "corrupt history",
    "wrong directory",
    "corrupt plans",
  ])("refuses unsafe stopped-chat continuation without starting agents: %s", async (failure) => {
    agents.script = () => "end_turn";
    const id = await ready();
    await controller.orchestrationChatAction({ type: "send", id, text: "Original task" });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    const taskId = controller.snapshot().chat.taskId as string;
    const chatDirectory = controller.snapshot().chat.directory as string;
    await controller.shutdown(true);
    const store = new ChatStore(join(directory, ".code60_workspace"));
    const saved = (await store.load()).chats.find((chat) => chat.runId === id);
    if (!saved) throw new Error("Expected a saved chat");
    const runFile = join(chatDirectory, ".code60", "runs", id, "run.json");
    const eventsFile = join(chatDirectory, ".code60", "runs", id, "events.jsonl");
    if (failure === "command") await store.save({ ...saved, commandHash: "0".repeat(64) });
    if (failure === "project") {
      const task = saved.tasks.find((task) => task.id === taskId);
      if (!task) throw new Error("Expected task");
      task.project = "/different-project";
      await store.save(saved);
    }
    if (failure === "live owner" || failure === "wrong directory") {
      const record = JSON.parse(await fs.readFile(runFile, "utf8"));
      await fs.writeFile(
        runFile,
        JSON.stringify({
          ...record,
          ...(failure === "live owner"
            ? { status: "running", ownerPid: process.pid }
            : { worktree: directory }),
        }),
      );
    }
    if (failure === "missing history") await fs.rm(eventsFile);
    if (failure === "corrupt history") await fs.writeFile(eventsFile, "{\n");
    if (failure === "corrupt plans") {
      await fs.mkdir(join(chatDirectory, ".code60", "plans"), { recursive: true });
      await fs.writeFile(join(chatDirectory, ".code60", "plans", `${randomUUID()}.json`), "{");
    }
    agents = new FakeAgents(() => "end_turn");
    controller = new DesktopController(
      controllerDeps(),
      { XDG_CONFIG_HOME: join(directory, "config"), XDG_STATE_HOME: join(directory, "state") },
      { confirm },
      { openDatabase, preferences },
    );
    await controller.restore();
    expect(controller.snapshot().chat.restored).toBe(true);
    expect(agents.specs).toHaveLength(0);
    await expect(
      controller.orchestrationChatAction({ type: "continue-task", id, taskId }),
    ).rejects.toThrow();
    expect(agents.specs).toHaveLength(0);
    expect(agents.restores).toHaveLength(0);
    expect((await store.load()).chats.find((chat) => chat.runId === id)?.tasks).toEqual(
      saved.tasks,
    );
  });

  function tableCaller(index = 0) {
    const server = agents.specs[index]?.mcpServers?.find((server) => server.name === "code60");
    if (!server || !("env" in server)) throw new Error("Expected an orchestration MCP server");
    const environment = Object.fromEntries(server.env.map((entry) => [entry.name, entry.value]));
    const url = environment.CODE60_MCP_GATEWAY_URL as string;
    return async (name: string, args: unknown = {}) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${environment.CODE60_MCP_GATEWAY_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name, arguments: args }),
      });
      return { status: response.status, body: await response.json() };
    };
  }

  it("never sends after a failed task snapshot write, and leaves explicit recovery retryable", async () => {
    agents.script = () => "end_turn";
    const id = await ready();
    const save = vi
      .spyOn(ChatStore.prototype, "save")
      .mockRejectedValueOnce(new Error("disk full"));
    try {
      await expect(
        controller.orchestrationChatAction({ type: "send", id, text: "Do not replay" }),
      ).rejects.toThrow("disk full");
      expect(agents.sessions[0]?.prompts).toEqual([]);
      expect(controller.snapshot().chat.taskId).toBeUndefined();
    } finally {
      save.mockRestore();
    }
    await controller.orchestrationChatAction({
      type: "set-tactic",
      id,
      project: null,
      tactic: "diagnose-a-bug",
    });
    await controller.orchestrationChatAction({ type: "send", id, text: "Diagnose original task" });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    const taskId = controller.snapshot().chat.taskId as string;
    await controller.shutdown(true);
    agents = new FakeAgents(() => "end_turn");
    agents.restoreUnavailable = true;
    agents.startError = new Error("provider unavailable");
    controller = new DesktopController(
      controllerDeps(),
      { XDG_CONFIG_HOME: join(directory, "config"), XDG_STATE_HOME: join(directory, "state") },
      { confirm },
      { openDatabase, preferences },
    );
    await controller.restore();
    await expect(
      controller.orchestrationChatAction({ type: "continue-task", id, taskId }),
    ).rejects.toThrow("provider unavailable");
    expect(agents.sessions).toHaveLength(0);
    expect(controller.snapshot().chat).toMatchObject({ restored: true, taskId });
    agents.startError = undefined;
    await controller.orchestrationChatAction({ type: "continue-task", id, taskId });
    await vi.waitFor(() => expect(agents.sessions[0]?.prompts).toHaveLength(1));
    expect(agents.sessions[0]?.prompts[0]).toContain("Tactic: Diagnose a bug");
    expect(agents.sessions[0]?.prompts[0]).not.toContain("Do not replay");
  });

  it("defers the saved registry until provider setup completes instead of replacing stopped history", async () => {
    const id = await ready();
    await controller.orchestrationChatAction({
      type: "set-tactic",
      id,
      project: null,
      tactic: "independent-review",
    });
    await controller.shutdown(true);
    agents = new FakeAgents();
    controller = new DesktopController(
      controllerDeps(),
      { XDG_CONFIG_HOME: join(directory, "config"), XDG_STATE_HOME: join(directory, "state") },
      { confirm },
      { openDatabase, preferences: { ...preferences, agentSetup: async () => null } },
    );
    await controller.restore();
    expect(agents.specs).toHaveLength(0);
    await setProvider("claude");
    expect(controller.snapshot().chat).toMatchObject({
      restored: true,
      tactic: "independent-review",
      run: { id },
      workers: [],
    });
    expect(agents.specs).toHaveLength(0);
  });

  it("keeps unavailable registry storage visible without automatically starting an agent", async () => {
    await ready();
    await controller.shutdown(true);
    const metadata = join(directory, ".code60_workspace", "chats");
    await fs.rename(metadata, `${metadata}.preserved`);
    await fs.writeFile(metadata, "not a directory");
    agents = new FakeAgents();
    controller = new DesktopController(
      controllerDeps(),
      { XDG_CONFIG_HOME: join(directory, "config"), XDG_STATE_HOME: join(directory, "state") },
      { confirm },
      { openDatabase, preferences },
    );
    await controller.restore();
    expect(controller.snapshot().chat.error).toContain("Saved chats");
    expect(agents.specs).toHaveLength(0);
    expect(await fs.readFile(metadata, "utf8")).toBe("not a directory");
  });

  it("serves turn-scoped display reports without project authority and keeps them out of run records", async () => {
    agents.script = () => "hang";
    const id = await ready();
    const call = tableCaller();
    expect((await call("code60_get_activity_context")).body.result.scope).toBeNull();
    await controller.orchestrationChatAction({ type: "send", id, text: "Inspect the results" });
    const context = (await call("code60_get_activity_context")).body.result;
    expect(context.scope).toBeTypeOf("string");
    expect(context.lastSequence).toBe(0);
    const args = {
      scope: context.scope,
      sequence: 1,
      operation: "set",
      activityType: "comparing",
      label: "Comparing worker results",
    };
    const accepted = await call("code60_report_activity", args);
    expect(accepted.status).toBe(200);
    expect(controller.snapshot().chat.activity).toMatchObject({
      state: "comparing",
      source: "declared",
    });
    expect((await call("code60_report_activity", args)).body).toEqual(accepted.body);
    expect((await call("code60_report_activity", { ...args, label: "Conflicting" })).status).toBe(
      400,
    );
    // Invalid display requests must not fail the agent's actual turn.
    expect(controller.snapshot().chat.run?.status).toBe("running");
    agents.sessions[0]?.update({
      type: "toolCall",
      toolCallId: "command",
      title: "Tests passed",
      kind: "execute",
      status: "in_progress",
    });
    expect(controller.snapshot().chat.activity).toMatchObject({
      state: "executing",
      source: "observed",
      declaration: { label: args.label },
    });
    // Snapshot reload includes live state; event history has no display mutations.
    expect(controller.snapshot(true).chat.activity).toEqual(
      controller.snapshot(false).chat.activity,
    );
    expect(
      controller
        .snapshot()
        .chat.events.some(({ event }) => "text" in event && event.text === args.label),
    ).toBe(false);
    await controller.orchestrationChatAction({ type: "cancel", id });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    expect(controller.snapshot().chat.activity).toMatchObject({
      state: "cancelled",
      declaration: null,
    });
    expect((await call("code60_report_activity", { ...args, sequence: 2 })).status).toBe(400);
    await controller.orchestrationChatAction({ type: "send", id, text: "Continue" });
    expect((await call("code60_get_activity_context")).body.result.scope).not.toBe(context.scope);
  });

  it("keeps live chat/manual servers on reload and applies new config to new/retried chats and manual runs", async () => {
    const first = await configureMcp();
    const id = await ready();
    await controller.open(directory);
    const [manualId] = await controller.start({ ...request, prompt: "hello" });
    await vi.waitFor(() => expect(agents.specs).toHaveLength(2));
    expect(agents.specs[0]?.mcpServers).toEqual([
      ...first,
      expect.objectContaining({ name: "code60" }),
    ]);
    expect(agents.specs[1]?.mcpServers).toEqual(first);
    const original = structuredClone(agents.specs);
    const next = await configureMcp("next");
    expect(controller.snapshot().chat.run?.id).toBe(id);
    expect(agents.specs).toEqual(original);
    expect(agents.sessions.every((session) => session.stops.length === 0)).toBe(true);
    await vi.waitFor(() =>
      expect(
        controller.snapshot().runs.find((run) => run.record.id === manualId)?.view?.status,
      ).toBe("idle"),
    );
    await controller.orchestrationChatAction({ type: "send", id, text: "same session" });
    await controller.action({ type: "reply", id: manualId as string, text: "same manual session" });
    expect(agents.specs).toHaveLength(2);
    await controller.start({ ...request, prompt: "new manual" });
    await vi.waitFor(() => expect(agents.specs).toHaveLength(3));
    expect(agents.specs[2]?.mcpServers).toEqual(next);
    await controller.orchestrationChatAction({ type: "new" });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    expect(agents.specs[3]?.mcpServers).toEqual([
      ...next,
      expect.objectContaining({ name: "code60" }),
    ]);
    await controller.orchestrationChatAction({ type: "restart", id });
    await vi.waitFor(() => expect(agents.specs).toHaveLength(5));
    expect(agents.specs[4]?.mcpServers).toEqual([
      ...next,
      expect.objectContaining({ name: "code60" }),
    ]);
    expect(JSON.stringify(controller.snapshot())).not.toContain("private-next");
    expect(JSON.stringify(controller.snapshot())).not.toContain("/private/first.js");
  });

  it("injects the latest saved contract without changing recorded user prompts", async () => {
    const id = await ready();
    const send = async (text: string) => {
      await controller.orchestrationChatAction({ type: "send", id, text });
      await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    };
    await send("first");
    expect(agents.sessions[0]?.prompts[0]).toBe(
      `${assembleOperatingContract(DEFAULT_PROMPT_TEMPLATES.operatingContract)}\n\n--- User request ---\nfirst`,
    );
    const edited = {
      ...DEFAULT_PROMPT_TEMPLATES.operatingContract,
      role: "Edited Code60 role.",
      planning: "Make a plan before starting work.",
    };
    await controller.savePromptTemplate({
      id: "operatingContract",
      template: edited,
    });
    await send("second");
    expect(agents.sessions[0]?.prompts[1]).toBe(
      `${assembleOperatingContract(edited)}\n\n--- User request ---\nsecond`,
    );
    await controller.resetPromptTemplate("operatingContract");
    await send("third");
    expect(agents.sessions[0]?.prompts[2]).toContain(
      assembleOperatingContract(DEFAULT_PROMPT_TEMPLATES.operatingContract),
    );
    expect(
      controller
        .snapshot()
        .chat.events.map(({ event }) => event)
        .filter((event) => event.type === "prompt")
        .map((event) => event.text),
    ).toEqual(["first", "second", "third"]);
    expect(agents.specs).toHaveLength(1);
  });

  it("expands the built-in create-command from a fresh database and keeps the typed transcript", async () => {
    const id = await ready();
    expect(controller.snapshot().commands).toEqual([]);
    for (const text of ["/create-command Review SQL migrations for safety.", "/create-command"]) {
      await controller.orchestrationChatAction({
        type: "send",
        id,
        text,
        command: "create-command",
      });
      await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
      expect(agents.sessions[0]?.prompts.at(-1)).toContain("Use code60_create_command");
      if (text.includes("Review SQL"))
        expect(agents.sessions[0]?.prompts.at(-1)).toContain(
          "Additional instructions:\nReview SQL migrations for safety.",
        );
      expect(
        controller
          .snapshot()
          .chat.events.map(({ event }) => event)
          .findLast((event) => event.type === "prompt"),
      ).toMatchObject({ text });
      expect(controller.snapshot().commands).toEqual([]);
    }
    await controller.saveCommand({
      name: "create-command",
      title: "My creator",
      prompt: "User-defined creator.",
    });
    await controller.orchestrationChatAction({
      type: "send",
      id,
      text: "/create-command",
      command: "create-command",
    });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    expect(agents.sessions[0]?.prompts.at(-1)).toContain("User-defined creator.");
    expect(agents.sessions[0]?.prompts.at(-1)).toBe(
      `${assembleOperatingContract(DEFAULT_PROMPT_TEMPLATES.operatingContract)}\n\n--- User request ---\nCommand /create-command: My creator\nUser-defined creator.`,
    );
  });

  it.each(["plan", "business-evaluation"])(
    "delivers the complete /%s built-in without saving it",
    async (name) => {
      const id = await ready();
      const builtin = BUILTIN_COMMANDS.find((entry) => entry.name === name);
      if (!builtin) throw new Error(`Missing /${name}`);
      for (const suffix of [
        "",
        " A tool for independent bookshops.\nCompare possible business models.",
      ]) {
        const text = `/${name}${suffix}`;
        await controller.orchestrationChatAction({ type: "send", id, text, command: name });
        await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
        expect(agents.sessions[0]?.prompts.at(-1)).toBe(
          `${assembleOperatingContract(DEFAULT_PROMPT_TEMPLATES.operatingContract)}\n\n--- User request ---\nCommand /${name}: ${builtin.title}\n${builtin.prompt}${suffix ? `\n\nAdditional instructions:\n${suffix.trim()}` : ""}`,
        );
        expect(controller.snapshot().commands).toEqual([]);
        expect(
          controller
            .snapshot()
            .chat.events.map(({ event }) => event)
            .findLast((event) => event.type === "prompt"),
        ).toMatchObject({ text });
      }
    },
  );

  it("expands the latest command on send but records the exact typed text", async () => {
    const id = await ready();
    const fields = {
      name: "review",
      title: "Review code",
      description: "",
      prompt: "Inspect the diff.",
    };
    await controller.saveCommand(fields);
    const command = controller.snapshot().commands[0];
    expect(command?.name).toBe("review");
    for (const [text, expected] of [
      ["/review", "Command /review: Review code\nInspect the diff."],
      [
        "/REVIEW  Focus on errors.\n",
        "Command /review: Review code\nInspect the diff.\n\nAdditional instructions:\nFocus on errors.",
      ],
    ]) {
      await controller.orchestrationChatAction({
        type: "send",
        id,
        text: text as string,
        command: "review",
      });
      await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
      expect(agents.sessions[0]?.prompts.at(-1)).toBe(
        `${assembleOperatingContract(DEFAULT_PROMPT_TEMPLATES.operatingContract)}\n\n--- User request ---\n${expected}`,
      );
      const event = controller
        .snapshot()
        .chat.events.map(({ event }) => event)
        .findLast((event) => event.type === "prompt");
      expect(event).toMatchObject({ text });
    }
    await controller.saveCommand({
      ...fields,
      id: command?.id as string,
      prompt: "Updated instructions.",
    });
    await controller.orchestrationChatAction({
      type: "send",
      id,
      text: "/review",
      command: "review",
    });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    expect(agents.sessions[0]?.prompts.at(-1)).toContain("Updated instructions.");
    await expect(
      controller.orchestrationChatAction({
        type: "send",
        id,
        text: "not a command",
        command: "review",
      }),
    ).rejects.toThrow(/beginning/);
    confirm.mockResolvedValueOnce(false);
    expect(await controller.deleteCommand({ id: command?.id as string })).toBe(false);
    expect(controller.snapshot().commands).toHaveLength(1);
    expect(await controller.deleteCommand({ id: command?.id as string })).toBe(true);
    const turns = controller.snapshot().chat.run?.turns;
    await expect(
      controller.orchestrationChatAction({ type: "send", id, text: "/review", command: "review" }),
    ).rejects.toThrow("Command /review no longer exists");
    expect(controller.snapshot().chat.run?.turns).toBe(turns);
    await controller.orchestrationChatAction({ type: "send", id, text: "/tmp is full" });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    expect(agents.sessions[0]?.prompts.at(-1)).toContain("--- User request ---\n/tmp is full");
  });

  it("shares commands across project switches, not databases, and rejects invalid writes", async () => {
    await controller.saveCommand({ name: "review", title: "Review", prompt: "Review code." });
    const command = controller.snapshot().commands[0] as Command;
    await controller.open(directory);
    expect(controller.snapshot().commands).toEqual([command]);
    await expect(
      controller.saveCommand({ name: "review", title: "Duplicate", prompt: "Prompt" }),
    ).rejects.toThrow(/already exists/);
    await expect(
      controller.saveCommand({ name: "Bad Name", title: "Title", prompt: "Prompt" }),
    ).rejects.toThrow();
    await expect(
      controller.saveCommand({ id: randomUUID(), name: "gone", title: "Gone", prompt: "Prompt" }),
    ).rejects.toThrow(/no longer exists/);
    await controller.connect(join(directory, "other.sqlite"), true);
    expect(controller.snapshot().commands).toEqual([]);
    await controller.connect(join(directory, "first.sqlite"), false);
    expect(controller.snapshot().commands).toEqual([command]);
  });

  it("provides read/search for every UI table, with current-project scope and no mutation tools", async () => {
    await ready();
    const call = tableCaller();
    expect(agents.specs[0]?.mcpServers).toContainEqual(
      expect.objectContaining({ name: "code60", command: process.execPath }),
    );
    expect((await call("code60_read_sessions")).body.result.rows).toEqual([]);
    await controller.open(directory);
    await controller.saveConfiguration({ name: "Team Alpha", settings: request });
    git.listedWorktrees = [{ path: directory, branch: "main", createdAt: null, sizeBytes: 42 }];
    await controller.poll(["worktrees"]);
    const [runId] = await controller.start({ ...request, prompt: "Project hello" });
    await vi.waitFor(() => expect(controller.snapshot().runs[0]?.view?.status).toBe("idle"));
    expect(agents.specs[1]?.mcpServers).toBeUndefined();
    agents.sessions[1]?.update({ type: "message", text: "Streamed " });
    agents.sessions[1]?.update({ type: "message", text: "reply" });
    const sessions = await call("code60_search_sessions", { query: runId });
    expect(sessions.body.result.rows).toEqual([
      expect.objectContaining({ id: runId, agent: "claude", turns: 1 }),
    ]);
    const messages = await call("code60_search_messages", { query: "STREAMED REPLY" });
    expect(messages.body.result.rows).toEqual([
      expect.objectContaining({ kind: "Message", text: "Streamed reply" }),
    ]);
    const events = await call("code60_search_events", { query: "Streamed " });
    expect(events.body.result.rows).toEqual([
      expect.objectContaining({
        session: runId,
        agent: "claude",
        type: "message",
        details: JSON.stringify({ text: "Streamed " }),
      }),
    ]);
    const statusEvents = await call("code60_search_events", { query: "running" });
    expect(statusEvents.body.result.rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "status", status: "running" })]),
    );
    const configurations = await call("code60_search_configurations", { query: "alpha" });
    expect(configurations.body.result.rows).toEqual([
      expect.objectContaining({ name: "Team Alpha", agents: 1, uses: 0 }),
    ]);
    const worktrees = await call("code60_read_worktrees");
    expect(worktrees.body.result.rows).toEqual([
      expect.objectContaining({ path: directory, branch: "main", sizeBytes: 42 }),
    ]);
    const polling = await call("code60_search_polling", { query: "Worktrees" });
    expect(polling.body.result.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rowType: "source", source: "Worktrees" }),
        expect.objectContaining({ rowType: "result", source: "Worktrees", trigger: "manual" }),
      ]),
    );
    expect((await call("code60_delete_sessions")).status).toBe(400);
    expect((await call("code60_read_sessions", { path: "/another-project" })).status).toBe(400);

    await controller.action({ type: "finish", id: runId as string });
    await vi.waitFor(() => expect(controller.active).toBe(false));
    await controller.poll(["history"]);
    const historical = await call("code60_search_messages", { query: "Streamed reply" });
    expect(historical.body.result.total).toBe(1);
    expect((await call("code60_search_events", { query: "Streamed " })).body.result.rows).toEqual(
      events.body.result.rows,
    );
    const next = join(directory, "another");
    await fs.mkdir(next);
    git.repoInfo = async () => ({ topLevel: next, commonDir: join(next, ".git") });
    await controller.open(next);
    expect((await call("code60_read_sessions")).body.result.rows).toEqual([]);
    expect((await call("code60_read_messages")).body.result.rows).toEqual([]);
    expect((await call("code60_read_events")).body.result.rows).toEqual([]);
    expect((await call("code60_read_configurations")).body.result.total).toBe(1);
    expect((await call("code60_read_worktrees")).status).toBe(400);

    await setProvider(null);
    await expect(call("code60_read_sessions")).rejects.toThrow();
  });

  it("titles the first exchange once, preserves manual names, and archives without deleting records", async () => {
    agents.script = (_text, session) => {
      session.update({ type: "message", text: "Parser validation" });
      return "end_turn";
    };
    const id = await ready();
    await controller.orchestrationChatAction({ type: "send", id, text: "Fix the parser" });
    await vi.waitFor(() => expect(controller.snapshot().chat.title).toBe("Parser validation"));
    const count = agents.sessions.length;
    await controller.orchestrationChatAction({ type: "rename", id, title: "My parser work" });
    await controller.orchestrationChatAction({ type: "send", id, text: "Next step" });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    expect(agents.sessions).toHaveLength(count);
    const directory = controller.snapshot().chat.directory as string;
    await controller.orchestrationChatAction({ type: "archive", id });
    expect(controller.snapshot().chat.run?.id).not.toBe(id);
    expect(controller.snapshot().chats.find((chat) => chat.run?.id === id)).toMatchObject({
      title: "My parser work",
      archived: true,
      directory,
    });
    expect(await fs.readFile(join(directory, ".code60", "runs", id, "run.json"), "utf8")).toContain(
      id,
    );
    await expect(controller.orchestrationChatAction({ type: "select", id })).rejects.toThrow(
      "archived",
    );
  });

  it("a manual rename wins over pending agent title generation", async () => {
    agents.script = (text, session) => {
      if (text.startsWith("Write a descriptive chat title")) return "hang";
      session.update({ type: "message", text: "Done" });
      return "end_turn";
    };
    const id = await ready();
    await controller.orchestrationChatAction({ type: "send", id, text: "First exchange" });
    await vi.waitFor(() => expect(agents.sessions).toHaveLength(2));
    await controller.orchestrationChatAction({ type: "rename", id, title: "Human title" });
    await vi.waitFor(() => expect(agents.sessions[1]?.stops).toEqual([1_000]));
    expect(controller.snapshot().chat.title).toBe("Human title");
  });

  it.each(["provider", "stop all", "shutdown"])(
    "cleans up pending title generation on %s",
    async (action) => {
      agents.script = (text, session) => {
        if (text.startsWith("Write a descriptive chat title")) return "hang";
        session.update({ type: "message", text: "Done" });
        return "end_turn";
      };
      const id = await ready();
      await controller.orchestrationChatAction({ type: "send", id, text: "First exchange" });
      await vi.waitFor(() => expect(agents.sessions).toHaveLength(2));
      const helperDirectory = agents.specs[1]?.cwd as string;
      if (action === "provider") await setProvider("codex");
      else if (action === "stop all") await controller.stopAll();
      else await controller.shutdown();
      expect(agents.sessions[1]?.stops).toEqual([1_000]);
      await expect(fs.stat(helperDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it("archiving a background chat leaves its work running and selection unchanged", async () => {
    agents.script = () => "hang";
    const id = await ready();
    await controller.orchestrationChatAction({ type: "new" });
    const selected = controller.snapshot().chat.run?.id;
    await controller.orchestrationChatAction({ type: "send", id, text: "Keep working" });
    await controller.orchestrationChatAction({ type: "archive", id });
    expect(controller.snapshot().chat.run?.id).toBe(selected);
    expect(controller.snapshot().chats.find((chat) => chat.run?.id === id)).toMatchObject({
      archived: true,
      run: { status: "running" },
    });
    expect(agents.sessions[0]?.stops).toEqual([]);
  });

  it("creates private chat folders, routes background turns, and retains independent transcripts", async () => {
    agents.script = () => "hang";
    const firstId = await ready();
    const first = controller.snapshot().chat;
    const root = join(directory, ".code60_workspace");
    expect(first.directory).not.toBe(root);
    expect(first.directory?.startsWith(`${root}${sep}`)).toBe(true);
    await fs.writeFile(join(first.directory as string, "notes.txt"), "first chat");
    await controller.orchestrationChatAction({ type: "send", id: firstId, text: "first" });
    await controller.orchestrationChatAction({ type: "new" });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    const second = controller.snapshot().chat;
    const secondId = second.run?.id as string;
    expect(secondId).not.toBe(firstId);
    expect(second.directory).not.toBe(first.directory);
    if (process.platform !== "win32")
      expect((await fs.stat(second.directory as string)).mode & 0o777).toBe(0o700);
    expect(await fs.readFile(join(first.directory as string, "notes.txt"), "utf8")).toBe(
      "first chat",
    );
    expect(await fs.readdir(second.directory as string)).not.toContain("notes.txt");
    expect(agents.sessions[0]?.stops).toEqual([]);
    expect(controller.hasActiveWork).toBe(true);
    expect(controller.snapshot().chats).toHaveLength(2);

    agents.sessions[0]?.update({ type: "message", text: "background reply" });
    agents.sessions[0]?.endTurn("end_turn");
    await vi.waitFor(() => expect(controller.snapshot().chats[0]?.run?.status).toBe("idle"));
    expect(controller.snapshot().chat.events.some(({ event }) => event.type === "message")).toBe(
      false,
    );
    await controller.orchestrationChatAction({ type: "send", id: secondId, text: "second" });
    // Requests target the specified chat even if another chat is selected.
    await controller.orchestrationChatAction({
      type: "send",
      id: firstId,
      text: "first follow-up",
    });
    await controller.orchestrationChatAction({ type: "select", id: firstId });
    expect(controller.snapshot().chat.run?.id).toBe(firstId);
    expect(controller.snapshot().chat.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: expect.objectContaining({ text: "background reply" }) }),
      ]),
    );
    expect(agents.sessions[0]?.prompts.at(-1)).toContain("first follow-up");
    expect(agents.sessions[1]?.prompts.at(-1)).toContain("second");
    await controller.stopAll();
    expect(controller.snapshot().chats.every((chat) => chat.run?.status === "cancelled")).toBe(
      true,
    );
    expect(
      agents.sessions
        .filter((_, index) => agents.specs[index]?.mcpServers?.length)
        .map((session) => session.stops.length),
    ).toEqual([1, 1]);
    expect(agents.sessions.every((session) => session.stops.length === 1)).toBe(true);
    for (const chat of controller.snapshot().chats) {
      const record = JSON.parse(
        await fs.readFile(
          join(chat.directory as string, ".code60", "runs", chat.run?.id as string, "run.json"),
          "utf8",
        ),
      );
      expect(record.worktree).toBe(chat.directory);
    }
  });

  it.each([false, true])("shuts down all orchestrator chats (force=%s)", async (force) => {
    await ready();
    await controller.orchestrationChatAction({ type: "new" });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    await controller.shutdown(force);
    expect(agents.sessions.every((session) => session.stops.length >= 1)).toBe(true);
    expect(controller.snapshot().chats.every((chat) => chat.run?.status === "finished")).toBe(true);
  });

  it("replaces all chats on provider changes but retries only the selected chat", async () => {
    const firstId = await ready();
    await controller.orchestrationChatAction({ type: "new" });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    const secondId = controller.snapshot().chat.run?.id as string;
    await controller.orchestrationChatAction({ type: "restart", id: secondId });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    expect(controller.snapshot().chats[0]?.run?.id).toBe(firstId);
    expect(agents.sessions[0]?.stops).toEqual([]);
    await expect(
      controller.orchestrationChatAction({ type: "select", id: secondId }),
    ).rejects.toThrow("no longer current");
    await setProvider("codex");
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    expect(controller.snapshot().chats).toHaveLength(1);
    expect(agents.sessions.slice(0, 3).map((session) => session.stops.length)).toEqual([1, 1, 1]);
  });

  it("starts fresh at restore and streams replies with allow-all, independently of project changes", async () => {
    orchestrationProvider = "claude";
    agents.script = (text, session) => {
      session.update({
        type: "message",
        text: `reply: ${text.split("--- User request ---\n").at(-1)}`,
      });
      return "end_turn";
    };
    await controller.restore();
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    const id = controller.snapshot().chat.run?.id as string;
    expect(agents.specs[0]?.cwd).toBe(controller.snapshot().chat.directory);
    expect(agents.sessions[0]?.prompts).toEqual([]);
    expect(controller.snapshot().runs).toEqual([]);
    expect(confirm).not.toHaveBeenCalled();
    expect(
      await agents.sessions[0]?.requestPermission({
        toolCallId: "edit",
        title: "Edit",
        kind: "edit",
      }),
    ).toBe("allow");
    await controller.orchestrationChatAction({ type: "send", id, text: "hello" });
    await vi.waitFor(() =>
      expect(controller.snapshot().chat.run).toMatchObject({ status: "idle", turns: 1 }),
    );
    expect(controller.snapshot().chat.events.map((entry) => entry.event)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "prompt", text: "hello" }),
        expect.objectContaining({ type: "message", text: "reply: hello" }),
        expect.objectContaining({ type: "permission", decision: "allowed", by: "policy" }),
      ]),
    );
    const second = join(directory, "project-two");
    await fs.mkdir(second);
    await controller.open(directory);
    await controller.open(second);
    expect(controller.snapshot().chat.run?.id).toBe(id);
    expect(agents.specs.filter((spec) => spec.mcpServers?.length)).toHaveLength(1);
    expect(controller.snapshot().chat.events.some((entry) => entry.event.type === "message")).toBe(
      true,
    );
    await controller.orchestrationChatAction({ type: "send", id, text: "after project switch" });
    await vi.waitFor(() =>
      expect(
        controller
          .snapshot()
          .chat.events.some(
            (entry) =>
              entry.event.type === "message" && entry.event.text === "reply: after project switch",
          ),
      ).toBe(true),
    );
  });

  it("replaces sessions on provider/database changes and refuses stale actions", async () => {
    const id = await ready();
    await setProvider("codex");
    await vi.waitFor(() =>
      expect(controller.snapshot().chat.run).toMatchObject({ status: "idle", agent: "codex" }),
    );
    expect(agents.sessions[0]?.stops).toHaveLength(1);
    await expect(
      controller.orchestrationChatAction({ type: "send", id, text: "stale" }),
    ).rejects.toThrow("no longer current");
    const providerId = controller.snapshot().chat.run?.id;
    await controller.connect(join(directory, "second.sqlite"), true);
    expect(controller.snapshot().chat.run?.id).not.toBe(providerId);
    expect(controller.snapshot().chat.events.some((entry) => entry.event.type === "prompt")).toBe(
      false,
    );
    await setProvider(null);
    expect(controller.snapshot().chat.run).toBeNull();
    expect(controller.snapshot().chat.events).toEqual([]);
  });

  it("cancels a turn, accepts another reply and includes chat in Stop all", async () => {
    agents.script = () => "hang";
    const id = await ready();
    expect(controller.hasActiveWork).toBe(false);
    await controller.orchestrationChatAction({ type: "send", id, text: "working" });
    expect(controller.hasActiveWork).toBe(true);
    await controller.orchestrationChatAction({ type: "cancel", id });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    expect(agents.sessions[0]?.cancels).toBe(1);
    agents.script = () => "end_turn";
    // The existing fake session retains its original hanging turn script.
    await controller.orchestrationChatAction({ type: "send", id, text: "again" });
    expect(agents.sessions[0]?.prompts).toEqual([
      `${assembleOperatingContract(DEFAULT_PROMPT_TEMPLATES.operatingContract)}\n\n--- User request ---\nworking`,
      `${assembleOperatingContract(DEFAULT_PROMPT_TEMPLATES.operatingContract)}\n\n--- User request ---\nagain`,
    ]);
    await controller.stopAll();
    expect(controller.snapshot().chat.run?.status).toBe("cancelled");
    expect(agents.sessions[0]?.stops).toHaveLength(1);
    await controller.poll(["config"]);
    expect(controller.snapshot().chat.run?.id).toBe(id);
    expect(agents.specs).toHaveLength(1);
  });

  it("surfaces startup failures and retries with a new ACP session", async () => {
    agents.startError = new Error("ACP authentication required");
    await setProvider("claude");
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("failed"));
    const id = controller.snapshot().chat.run?.id as string;
    expect(controller.snapshot().chat.run?.reason).toContain("authentication");
    agents.startError = undefined;
    await controller.orchestrationChatAction({ type: "restart", id });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    expect(controller.snapshot().chat.run?.id).not.toBe(id);
  });

  it("aborts ACP startup during shutdown", async () => {
    agents.startGate = new Promise(() => {});
    await setProvider("claude");
    await vi.waitFor(() => expect(agents.specs).toHaveLength(1));
    expect(controller.hasActiveWork).toBe(true);
    await controller.shutdown(true);
    expect(controller.snapshot().chat.run?.status).toBe("cancelled");
    expect(agents.sessions).toEqual([]);
  });

  it("reports worktree-directory conflicts without overwriting existing files", async () => {
    const folder = join(directory, ".code60_workspace");
    await fs.writeFile(folder, "preserve me");
    await setProvider("claude");
    expect(controller.snapshot().chat.error).toBeTruthy();
    expect(await fs.readFile(folder, "utf8")).toBe("preserve me");
    expect(controller.connected).toBe(true);
    await fs.rm(folder);
    await controller.orchestrationChatAction({ type: "restart", id: null });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    if (process.platform !== "win32") expect((await fs.stat(folder)).mode & 0o777).toBe(0o700);
  });
});

it("keeps orchestration Chat available while blocking non-Git project workers", async () => {
  await setProvider("claude");
  await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
  git.repoInfo = async () => {
    throw new Error("not a repository");
  };
  await controller.open(directory);
  await expect(controller.start(request)).rejects.toThrow("Set up Git");
  const id = controller.snapshot().chat.run?.id as string;
  await controller.orchestrationChatAction({ type: "send", id, text: "Discuss the project" });
  expect(controller.snapshot().runs).toEqual([]);
  expect(confirm).not.toHaveBeenCalled();
});

it("cancels queued and active Git setup without blocking ordinary Chat", async () => {
  await setProvider("claude");
  await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
  const ops = defaultDeps().git.setup;
  if (!ops) throw new Error("Missing Git setup");
  const preview = vi.fn(
    async (_project: string, signal?: AbortSignal): Promise<never> =>
      new Promise((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true }),
      ),
  );
  Object.assign(git, {
    setup: {
      ...ops,
      readiness: async () => ({ status: "not_repository", message: "Needs Git" }),
      preview,
    },
  });
  await controller.open(directory);
  const project = controller.snapshot().directory as string;
  const queued = controller.beginGitSetup({ project });
  const queuedRejection = expect(queued).rejects.toThrow("cancelled");
  await controller.cancelGitSetup({ project });
  await queuedRejection;
  expect(preview).not.toHaveBeenCalled();
  const pending = controller.beginGitSetup({ project });
  const rejected = expect(pending).rejects.toThrow("cancelled");
  await vi.waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
  await expect(controller.beginGitSetup({ project })).rejects.toThrow("already in progress");
  await expect(controller.start(request)).rejects.toThrow("Finish Git setup");
  await controller.orchestrationChatAction({
    type: "send",
    id: controller.snapshot().chat.run?.id as string,
    text: "Talk while preview waits",
  });
  await controller.cancelGitSetup({ project });
  await rejected;
  expect(controller.snapshot().runs).toHaveLength(0);
});
it("keeps Chat responsive during the post-setup readiness check", async () => {
  await setProvider("claude");
  await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
  await controller.open(directory);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const readiness = vi.fn(async () => {
    await gate;
    return { status: "not_repository" as const, message: "Needs Git" };
  });
  Object.assign(git, {
    setup: {
      ...defaultDeps().git.setup,
      readiness,
      preview: async () => ({
        readiness: { status: "not_repository", message: "Needs Git" },
        files: [],
        excluded: [],
        author: { name: "Test", email: "test@example.invalid" },
      }),
    },
  });
  const pending = controller.beginGitSetup({ project: controller.snapshot().directory as string });
  try {
    await vi.waitFor(() => expect(readiness).toHaveBeenCalled());
    await controller.orchestrationChatAction({
      type: "send",
      id: controller.snapshot().chat.run?.id as string,
      text: "Discuss while Git settles",
    });
  } finally {
    release();
    await pending;
  }
});

it("refuses Git setup while project workers are still owned", async () => {
  await start();
  const preview = vi.fn();
  Object.assign(git, { setup: { ...defaultDeps().git.setup, preview } });
  await expect(
    controller.beginGitSetup({ project: controller.snapshot().directory as string }),
  ).rejects.toThrow("Stop project workers");
  expect(preview).not.toHaveBeenCalled();
});

describe("orchestrated workers over ACP", () => {
  it("keeps correction and failure updates with the original tactic after a newer human task and capacity rejection", async () => {
    await fs.mkdir(join(directory, "config", "code60"), { recursive: true });
    await fs.writeFile(
      join(directory, "config", "code60", "config.json"),
      JSON.stringify({ maxParallel: 1 }),
    );
    await controller.poll(["config"]);
    const { call, scope } = await setup(1);
    const chatId = controller.snapshot().chat.run?.id as string;
    const project = controller.snapshot().directory;
    await controller.orchestrationChatAction({
      type: "set-tactic",
      id: chatId,
      project,
      tactic: "implement-and-review",
    });
    await controller.orchestrationChatAction({
      type: "send",
      id: chatId,
      text: "Original feature",
    });
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
    const taskId = controller.snapshot().chat.taskId;
    const owner = await dispatch(call, scope, "HANG implementing");
    await vi.waitFor(() => expect(session(owner)?.turnActive).toBe(true));
    await controller.orchestrationChatAction({
      type: "set-tactic",
      id: chatId,
      project,
      tactic: "explore-the-codebase",
    });
    await controller.orchestrationChatAction({ type: "send", id: chatId, text: "New code map" });
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
    expect(
      (
        await call("code60_dispatch_agent", {
          scope,
          requestId: "no-slot",
          prompt: "Review in another slot",
        })
      ).body.error,
    ).toContain("slots are in use");
    session(owner)?.update({
      type: "message",
      text: "Finding: repeated failure needs correction; missing test evidence.",
    });
    session(owner)?.endTurn("end_turn");
    await vi.waitFor(() => expect(chatPrompts()).toHaveLength(3));
    expect(chatPrompts()[2]).toContain("Tactic: Implement and review");
    expect(chatPrompts()[2]).not.toContain("New code map");
    expect(controller.snapshot().chat.taskId).toBe(taskId);
    for (const round of [1, 2]) {
      await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
      await call("code60_send_agent", {
        scope,
        runId: owner,
        prompt: `Correction ${round}: HANG for evidence`,
      });
      await vi.waitFor(() => expect(session(owner)?.turnActive).toBe(true));
      session(owner)?.update({
        type: "message",
        text: "Same problem persists. Evidence incomplete; report a blocker.",
      });
      session(owner)?.endTurn("end_turn");
      await vi.waitFor(() => expect(chatPrompts()).toHaveLength(3 + round));
      expect(chatPrompts().at(-1)).toContain("at most two correction rounds");
      expect(chatPrompts().at(-1)).toContain("Same problem persists");
      expect(chatPrompts().at(-1)).toContain(
        "Missing, inaccessible, partial, or truncated evidence is incomplete",
      );
    }
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
    await call("code60_send_agent", { scope, runId: owner, prompt: "HANG verify blocker" });
    await vi.waitFor(() => expect(session(owner)?.turnActive).toBe(true));
    session(owner)?.failTurn(new Error("Verifier unavailable; findings preserved"));
    await vi.waitFor(() => expect(chatPrompts()).toHaveLength(6));
    expect(chatPrompts().at(-1)).toContain("Verifier unavailable");
    expect(chatPrompts().at(-1)).toContain("not proof that the task succeeded");
    expect(controller.snapshot().chat.tactic).toBe("explore-the-codebase");
    const store = new ChatStore(join(directory, ".code60_workspace"));
    const saved = (await store.load()).chats.find((chat) => chat.runId === chatId);
    expect(
      saved?.tasks.find((task) => task.id === taskId)?.workers.map((worker) => worker.turn),
    ).toEqual([1, 2, 3, 4]);
  });

  type Call = (
    name: string,
    args?: unknown,
  ) => Promise<{
    status: number;
    body: {
      error: string;
      result: {
        scope: string;
        runId: string;
        workers: unknown[];
        entries: unknown[];
        [key: string]: unknown;
      };
    };
  }>;
  function caller(index = 0): Call {
    const server = agents.specs[index]?.mcpServers?.find((server) => server.name === "code60");
    if (!server || !("env" in server)) throw new Error("Expected an orchestration MCP server");
    const environment = Object.fromEntries(server.env.map((entry) => [entry.name, entry.value]));
    return async (name, args = {}) => {
      const response = await fetch(environment.CODE60_MCP_GATEWAY_URL as string, {
        method: "POST",
        headers: {
          authorization: `Bearer ${environment.CODE60_MCP_GATEWAY_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name, arguments: args }),
      });
      return { status: response.status, body: await response.json() };
    };
  }
  const session = (runId: string) =>
    agents.sessions[agents.specs.findIndex((spec) => spec.cwd.endsWith(runId))];
  const chatPrompts = () => agents.sessions[0]?.prompts ?? [];
  const chatStatus = () => controller.snapshot().chat.run?.status;

  async function setup(maxParallel = 4) {
    agents.script = (text, current) => {
      if (text.includes("HANG")) return "hang";
      if (!text.includes("--- ")) current.update({ type: "message", text: `done: ${text}` });
      return "end_turn";
    };
    await setProvider("claude");
    // Chat startup performs several helper-backed private writes on Windows.
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"), { timeout: 10_000 });
    await controller.open(directory);
    const call = caller();
    const context = await call("code60_get_context");
    expect(context.body.result).toMatchObject({
      project: await realOf(directory),
      gitRepository: true,
      defaultProvider: "claude",
      maxParallel,
      liveWorkers: 0,
    });
    return { call, scope: context.body.result.scope as string };
  }

  it("creates reusable commands through the chat gateway without executing or overwriting them", async () => {
    const { call } = await setup();
    const prompts = [...chatPrompts()];
    const fields = { name: "review", title: "Review changes", prompt: "Inspect the code." };
    const created = await call("code60_create_command", fields);
    expect(created.status).toBe(200);
    expect(created.body.result).toMatchObject({
      ...fields,
      description: "",
      id: expect.any(String),
    });
    expect(controller.snapshot().commands).toEqual([created.body.result]);
    expect(chatPrompts()).toEqual(prompts);
    expect(
      (await call("code60_create_command", { ...fields, prompt: "Replacement" })).body.error,
    ).toMatch(/already exists/);
    expect(
      (await call("code60_create_command", { ...fields, id: created.body.result.id })).status,
    ).toBe(400);
    expect(controller.snapshot().commands).toEqual([created.body.result]);

    const db = databases.get(join(directory, "first.sqlite"));
    if (!db) throw new Error("Expected connected database");
    db.failWrites = true;
    expect(
      (await call("code60_create_command", { ...fields, name: "failure" })).body.error,
    ).toMatch(/disk is full/);
    expect(controller.snapshot().commands).toEqual([created.body.result]);
    db.failWrites = false;
    const command = controller.snapshot().commands[0] as Command;
    db.commands = Array.from({ length: COMMAND_LIMIT - 1 }, (_, i) => ({
      ...command,
      id: randomUUID(),
      name: `saved-${i}`,
    }));
    expect((await call("code60_create_command", { ...fields, name: "last" })).status).toBe(200);
    expect(controller.snapshot().commands).toHaveLength(COMMAND_LIMIT);
    expect(
      (await call("code60_create_command", { ...fields, name: "overflow" })).body.error,
    ).toMatch(/at most 200/);
    expect(controller.snapshot().commands).toHaveLength(COMMAND_LIMIT);
  });

  it("gates a revised plan, accepts once and persists verified progress", async () => {
    const { call, scope } = await setup();
    const chatId = controller.snapshot().chat.run?.id as string;
    const created = await call("code60_create_plan", {
      requestId: "plan",
      title: "Build",
      description: "Details",
      tasks: [{ text: "Implement" }, { text: "Test" }],
    });
    expect(created.status).toBe(200);
    let plan = created.body.result as unknown as Plan;
    expect(controller.snapshot().chat.plans?.[0]).toMatchObject({
      state: "draft",
      total: 2,
      completed: 0,
    });
    expect(
      (await call("code60_dispatch_agent", { scope, requestId: "early", prompt: "Work" })).body
        .error,
    ).toContain("Accept");
    const revised = await call("code60_update_plan", {
      operation: "revise",
      planId: plan.id,
      revision: plan.revision,
      draft: {
        title: "Revised",
        description: "More detail",
        tasks: [{ id: plan.tasks[0]?.id, text: "Implement" }],
      },
    });
    expect(revised.status).toBe(200);
    await expect(
      controller.planAction({ type: "accept", chatId, planId: plan.id, revision: plan.revision }),
    ).rejects.toThrow("changed");
    plan = revised.body.result as unknown as Plan;
    const action = { type: "accept" as const, chatId, planId: plan.id, revision: plan.revision };
    const before = chatPrompts().length;
    await Promise.all([controller.planAction(action), controller.planAction(action)]);
    await vi.waitFor(() => expect(chatPrompts()).toHaveLength(before + 1));
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
    expect(
      (await call("code60_dispatch_agent", { scope, requestId: "no-task", prompt: "Work" })).body
        .error,
    ).toContain("planTaskId");
    const worker = await call("code60_dispatch_agent", {
      scope,
      requestId: "planned",
      prompt: "Work",
      planTaskId: plan.tasks[0]?.id,
    });
    expect(worker.status).toBe(200);
    await vi.waitFor(() => expect(session(worker.body.result.runId)?.prompts).toHaveLength(1));
    plan = await controller.readPlan({ chatId, planId: plan.id });
    expect(plan.tasks[0]?.workerIds).toContain(worker.body.result.runId);
    const progress = await call("code60_update_plan", {
      operation: "progress",
      planId: plan.id,
      revision: plan.revision,
      taskId: plan.tasks[0]?.id,
      state: "completed",
      note: "Inspected worker output and passing tests",
      workerIds: [worker.body.result.runId],
    });
    expect(progress.status).toBe(200);
    expect(controller.snapshot().chat.plans?.[0]).toMatchObject({
      state: "completed",
      completed: 1,
      total: 1,
    });
    const markdown = await fs.readFile(
      join(controller.snapshot().chat.directory as string, "plans", `${plan.id}.md`),
      "utf8",
    );
    expect(markdown).toContain("- [x] Implement");
    expect(markdown).not.toContain("out of");
    await controller.orchestrationChatAction({ type: "new" });
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
    const other = caller(
      agents.specs.findIndex((spec) => spec.cwd === controller.snapshot().chat.directory),
    );
    expect((await other("code60_read_plan", { planId: plan.id })).body.error).toContain(
      "Unknown plan",
    );
  });

  it("queues acceptance behind a busy chat, pauses on Stop and resumes only explicitly", async () => {
    const { call } = await setup();
    const chatId = controller.snapshot().chat.run?.id as string;
    await controller.orchestrationChatAction({ type: "send", id: chatId, text: "HANG while busy" });
    await vi.waitFor(() => expect(chatStatus()).toBe("running"));
    const created = await call("code60_create_plan", {
      requestId: "busy-plan",
      title: "Later",
      description: "",
      tasks: [{ text: "Work" }],
    });
    let plan = created.body.result as unknown as Plan;
    const before = chatPrompts().length;
    await controller.planAction({
      type: "accept",
      chatId,
      planId: plan.id,
      revision: plan.revision,
    });
    expect(controller.snapshot().chat.plans?.[0]?.state).toBe("queued");
    expect(chatPrompts()).toHaveLength(before);
    await controller.orchestrationChatAction({ type: "cancel", id: chatId });
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
    expect(controller.snapshot().chat.plans?.[0]?.state).toBe("paused");
    await controller.orchestrationChatAction({ type: "resume-updates", id: chatId });
    expect(chatPrompts()).toHaveLength(before);
    plan = await controller.readPlan({ chatId, planId: plan.id });
    await controller.planAction({
      type: "resume",
      chatId,
      planId: plan.id,
      revision: plan.revision,
    });
    await vi.waitFor(() => expect(chatPrompts()).toHaveLength(before + 1));
  });

  it("pauses accepted plans on project changes and releases draft gates only on dismissal", async () => {
    const { call } = await setup();
    const chatId = controller.snapshot().chat.run?.id as string;
    let result = await call("code60_create_plan", {
      requestId: "scope-plan",
      title: "Scoped",
      description: "",
      tasks: [{ text: "Work" }],
    });
    let plan = result.body.result as unknown as Plan;
    await controller.planAction({
      type: "accept",
      chatId,
      planId: plan.id,
      revision: plan.revision,
    });
    await vi.waitFor(() => expect(controller.snapshot().chat.plans?.[0]?.state).toBe("running"));
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
    const other = join(directory, "another-project");
    await fs.mkdir(other);
    await controller.open(other);
    plan = await controller.readPlan({ chatId, planId: plan.id });
    expect(plan.state).toBe("paused");
    await expect(
      controller.planAction({ type: "resume", chatId, planId: plan.id, revision: plan.revision }),
    ).rejects.toThrow("project");
    await controller.planAction({
      type: "dismiss",
      chatId,
      planId: plan.id,
      revision: plan.revision,
    });
    result = await call("code60_create_plan", {
      requestId: "new-scope-plan",
      title: "New",
      description: "",
      tasks: [{ text: "Work" }],
    });
    expect(result.status).toBe(200);
    plan = result.body.result as unknown as Plan;
    await controller.planAction({
      type: "dismiss",
      chatId,
      planId: plan.id,
      revision: plan.revision,
    });
    const context = await call("code60_get_context");
    expect(
      (
        await call("code60_dispatch_agent", {
          scope: context.body.result.scope,
          requestId: "direct",
          prompt: "Direct work",
        })
      ).status,
    ).toBe(200);
  });

  it("pauses when a planned worker turn fails instead of automatically retrying", async () => {
    const { call, scope } = await setup();
    const chatId = controller.snapshot().chat.run?.id as string;
    const created = await call("code60_create_plan", {
      requestId: "failure-plan",
      title: "Failure",
      description: "",
      tasks: [{ text: "Work" }],
    });
    const plan = created.body.result as unknown as Plan;
    await controller.planAction({
      type: "accept",
      chatId,
      planId: plan.id,
      revision: plan.revision,
    });
    await vi.waitFor(() => expect(controller.snapshot().chat.plans?.[0]?.state).toBe("running"));
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
    agents.script = () => "max_tokens";
    const worker = await call("code60_dispatch_agent", {
      scope,
      requestId: "failed-worker",
      prompt: "Work",
      planTaskId: plan.tasks[0]?.id,
    });
    expect(worker.status).toBe(200);
    await vi.waitFor(() => expect(controller.snapshot().chat.plans?.[0]?.state).toBe("paused"));
    expect(controller.snapshot().chat.plans?.[0]?.completed).toBe(0);
    expect(controller.snapshot().chat.updates.paused).toBe(true);
    expect(
      (await call("code60_send_agent", { scope, runId: worker.body.result.runId, prompt: "Retry" }))
        .body.error,
    ).toContain("resume");
  });

  async function dispatch(call: Call, scope: string, prompt: string, requestId = prompt) {
    const result = await call("code60_dispatch_agent", { scope, requestId, prompt });
    expect(result.status, result.body.error).toBe(200);
    return result.body.result.runId as string;
  }

  it("reports readiness and rejects MCP dispatch before creating workers or reviews", async () => {
    const { call, scope } = await setup();
    git.repoInfo = async () => {
      throw new Error("not a repository");
    };
    const context = await call("code60_get_context");
    expect(context.body.result.gitReadiness).toMatchObject({ status: "not_repository" });
    const result = await call("code60_dispatch_agent", {
      scope,
      requestId: "blocked",
      prompt: "task",
    });
    expect(result.body.error).toContain("Set up Git");
    expect(controller.snapshot().runs).toHaveLength(0);
    expect(controller.snapshot().reviews).toHaveLength(0);
    expect(agents.specs).toHaveLength(1);
  });

  it("rejects MCP send and resume for a worker with no baseline while keeping finish available", async () => {
    const { call, scope } = await setup();
    const id = await dispatch(call, scope, "task");
    await vi.waitFor(() =>
      expect(controller.snapshot().runs.find((run) => run.record.id === id)?.view?.status).toBe(
        "idle",
      ),
    );
    const workspace = await openWorkspace(controllerDeps(), directory, {
      XDG_STATE_HOME: join(directory, "state"),
    });
    const removeBaseline = async () =>
      workspace.store.save({ ...(await workspace.store.read(id)), base: null, branch: null });
    // Live status publishes before its queued record write. Do not race that write.
    await vi.waitFor(async () => expect((await workspace.store.read(id)).status).toBe("idle"));
    await removeBaseline();
    expect(
      (await call("code60_send_agent", { scope, runId: id, prompt: "more" })).body.error,
    ).toContain("No baseline");
    expect((await call("code60_finish_agent", { scope, runId: id })).status).toBe(200);
    await vi.waitFor(() => expect(controller.active).toBe(false));
    await vi.waitFor(async () => expect((await workspace.store.read(id)).status).toBe("finished"));
    await removeBaseline();
    expect(
      (await call("code60_resume_agent", { scope, runId: id, prompt: "resume" })).body.error,
    ).toContain("No baseline");
  });

  describe("desktop task application boundaries", () => {
    afterEach(() => vi.restoreAllMocks());

    async function taskFixture(content = Buffer.from("after\n")) {
      const project = await realOf(directory);
      const base = "a".repeat(40);
      const commit = "b".repeat(40);
      const before = "1".repeat(40);
      const after = "2".repeat(40);
      await fs.mkdir(join(project, ".git"), { recursive: true });
      await fs.writeFile(join(project, "task.txt"), "before\n");
      const tasks = {
        snapshot: vi.fn(async (path: string) => (path === project ? base : commit)),
        tree: vi.fn(async (_path: string, revision: string) => ({
          "task.txt": { mode: "100644", oid: revision === base ? before : after },
        })),
        blob: vi.fn(async (_path: string, oid: string) =>
          oid === before ? Buffer.from("before\n") : content,
        ),
        merge: vi.fn<TaskGit["merge"]>(async (_base, _current, proposed) => proposed),
        identity: vi.fn(async () => "unchanged-head-and-index"),
        lockPath: async () => join(project, ".git", "task.lock"),
      } satisfies TaskGit;
      Object.assign(git, {
        tasks,
        resolveCommit: async () => base,
        reviewSnapshot: async () => ({
          files: [
            {
              path: "task.txt",
              oldPath: "task.txt",
              status: "modified",
              original: "before\n",
              modified: "after\n",
              fingerprint: commit,
            },
          ],
          truncated: false,
        }),
      });
      const { call, scope } = await setup();
      const worker = await dispatch(call, scope, "task worker");
      await vi.waitFor(() =>
        expect(
          controller.snapshot().runs.find((run) => run.record.id === worker)?.view?.status,
        ).toBe("idle"),
      );
      const reviewId = controller.snapshot().reviews?.[0]?.id;
      if (!reviewId) throw new Error("Missing task review");
      const identity = { project, reviewId };
      await controller.captureReview({ ...identity, requestId: randomUUID() });
      const review = await controller.readReview({ ...identity, requestId: randomUUID() });
      const revisionId = review.revisions.at(-1)?.id;
      if (!revisionId) throw new Error("Missing task revision");
      return { identity, revisionId, tasks, call, scope, worker };
    }

    it("prepares, previews, applies and undoes through the real controller and task store", async () => {
      const { identity, revisionId, tasks } = await taskFixture();
      expect(await controller.taskAction({ ...identity, type: "status" })).toMatchObject({
        available: true,
        canPrepare: true,
        source: "Current saved files",
      });
      const prepared = await controller.taskAction({ ...identity, type: "prepare", revisionId });
      const operationId = prepared.operation?.id;
      const fileId = prepared.operation?.changes[0]?.id;
      if (!operationId || !fileId) throw new Error("Missing application preview");
      expect(
        await controller.taskAction({ ...identity, type: "file", operationId, fileId }),
      ).toMatchObject({ file: { path: "task.txt", original: "before\n", modified: "after\n" } });
      await expect(
        controller.taskAction({
          ...identity,
          type: "file",
          operationId,
          fileId: randomUUID(),
        }),
      ).rejects.toThrow("Unknown proposal file");
      await expect(
        controller.taskAction({
          ...identity,
          type: "revise",
          operationId,
        }),
      ).rejects.toThrow("Refresh the conflict preview");
      const applied = await controller.taskAction({ ...identity, type: "apply", operationId });
      expect(applied).toMatchObject({ undoId: operationId, operation: { status: "applied" } });
      expect(await fs.readFile(join(identity.project, "task.txt"), "utf8")).toBe("after\n");
      expect(
        (await controller.taskAction({ ...identity, type: "apply", operationId })).operation
          ?.status,
      ).toBe("applied");
      expect(
        (await controller.taskAction({ ...identity, type: "undo", operationId })).operation?.status,
      ).toBe("undone");
      expect(await fs.readFile(join(identity.project, "task.txt"), "utf8")).toBe("before\n");
      expect(
        (await controller.taskAction({ ...identity, type: "undo", operationId })).operation?.status,
      ).toBe("undone");
      await expect(
        controller.taskAction({
          ...identity,
          type: "recover",
          operationId,
        }),
      ).rejects.toThrow("No interrupted operation");
      expect(tasks.snapshot).toHaveBeenCalledWith(identity.project, {
        exclude: expect.arrayContaining([join(directory, "first.sqlite")]),
      });
    });

    it.each([Buffer.from([0]), Buffer.from([255]), Buffer.alloc(1_048_577, 65)])(
      "marks binary, invalid UTF-8 and oversized application previews as limited",
      async (content) => {
        const { identity, revisionId } = await taskFixture(content);
        const prepared = await controller.taskAction({ ...identity, type: "prepare", revisionId });
        const operationId = prepared.operation?.id;
        const fileId = prepared.operation?.changes[0]?.id;
        if (!operationId || !fileId) throw new Error("Missing binary preview");
        expect(
          await controller.taskAction({ ...identity, type: "file", operationId, fileId }),
        ).toMatchObject({ file: { original: "", modified: "", limitation: expect.any(String) } });
      },
    );

    it("rejects stale revisions, changed worker snapshots and incomplete captures", async () => {
      const { identity, revisionId, tasks } = await taskFixture();
      await expect(
        controller.taskAction({
          ...identity,
          type: "prepare",
          revisionId: randomUUID(),
        }),
      ).rejects.toThrow("Review the latest changes");
      const prepared = await controller.taskAction({ ...identity, type: "prepare", revisionId });
      const operationId = prepared.operation?.id;
      if (!operationId) throw new Error("Missing application");
      tasks.snapshot.mockResolvedValue("c".repeat(40));
      await expect(
        controller.taskAction({ ...identity, type: "apply", operationId }),
      ).rejects.toThrow("Worker files changed");
      expect(await fs.readFile(join(identity.project, "task.txt"), "utf8")).toBe("before\n");
      await controller.captureReview({ ...identity, requestId: randomUUID() });
      await expect(
        controller.taskAction({ ...identity, type: "apply", operationId }),
      ).rejects.toThrow("New changes are available");
      tasks.snapshot.mockRejectedValue(new Error("Worker snapshot unavailable"));
      await controller.captureReview({ ...identity, requestId: randomUUID() });
      const incomplete = await controller.readReview({ ...identity, requestId: randomUUID() });
      const latest = incomplete.revisions.at(-1)?.id;
      if (!latest) throw new Error("Missing incomplete revision");
      expect((await controller.taskAction({ ...identity, type: "status" })).canPrepare).toBe(false);
      await expect(
        controller.taskAction({ ...identity, type: "prepare", revisionId: latest }),
      ).rejects.toThrow("Refresh the incomplete review");
    });

    it.each(["cancel", "stopAll", "shutdown"] as const)(
      "keeps lifecycle guards effective during a task and settles %s cancellation",
      async (method) => {
        const { identity, revisionId, tasks, worker } = await taskFixture();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let entered = false;
        tasks.identity.mockImplementationOnce(async () => {
          entered = true;
          await gate;
          return "unchanged-head-and-index";
        });
        const pending = controller.taskAction({ ...identity, type: "prepare", revisionId });
        const settled = pending.then(
          () => ({ error: undefined }),
          (error: unknown) => ({ error }),
        );
        try {
          await vi.waitFor(() => expect(entered).toBe(true));
          await expect(
            controller.captureReview({ ...identity, requestId: randomUUID() }),
          ).rejects.toThrow("Wait for the task operation");
          await expect(
            controller.taskAction({ ...identity, type: "prepare", revisionId }),
          ).rejects.toThrow("Wait for the current task operation");
          await expect(controller.connect(join(directory, "other.sqlite"), true)).rejects.toThrow(
            "Wait for the task operation",
          );
          await expect(controller.open(directory)).rejects.toThrow(
            "Finish or stop all runs before switching folders",
          );
          await expect(controller.start(request)).rejects.toThrow("Wait for the task operation");
          await expect(controller.beginGitSetup({ project: identity.project })).rejects.toThrow(
            "Wait for the task operation",
          );
          await expect(controller.action({ type: "discard", id: worker })).rejects.toThrow(
            "Wait for the task operation",
          );
          await expect(
            controller.reviewAction({
              ...identity,
              type: "reconnect",
              chatId: controller.snapshot().chat.run?.id as string,
            }),
          ).rejects.toThrow("Wait for the task operation");
          const stopping =
            method === "cancel"
              ? controller.taskAction({ ...identity, type: "cancel" })
              : controller[method]();
          release();
          await expect(settled).resolves.toMatchObject({
            error: expect.objectContaining({
              message: expect.stringMatching(/cancelled|stopping/),
            }),
          });
          await stopping;
          if (method !== "shutdown")
            expect((await controller.taskAction({ ...identity, type: "cancel" })).available).toBe(
              true,
            );
        } finally {
          release();
          await settled;
        }
      },
    );

    it("routes conflict revision requests only through the owning conversation", async () => {
      const { identity, revisionId, tasks } = await taskFixture();
      await fs.writeFile(join(identity.project, "task.txt"), "human edit\n");
      tasks.merge.mockResolvedValue(null);
      const prepared = await controller.taskAction({ ...identity, type: "prepare", revisionId });
      const operationId = prepared.operation?.id;
      if (!operationId) throw new Error("Missing conflict preview");
      expect(prepared.operation?.conflicts).toHaveLength(1);
      await controller.taskAction({ ...identity, type: "revise", operationId });
      const review = await controller.readReview({ ...identity, requestId: randomUUID() });
      expect(review.comments.at(-1)?.text).toContain("Preserve the user's current project edits.");
      expect(review.submissions.at(-1)?.revisionId).toBe(revisionId);
      const oldChat = controller.snapshot().chat.run?.id as string;
      await controller.orchestrationChatAction({ type: "restart", id: oldChat });
      await expect(
        controller.taskAction({ ...identity, type: "revise", operationId }),
      ).rejects.toThrow("Reconnect this review");
      expect(await fs.readFile(join(identity.project, "task.txt"), "utf8")).toBe("human edit\n");
    });
    it("settles project cleanup ahead of queued conflict feedback without later writing it", async () => {
      const { identity, revisionId, tasks } = await taskFixture();
      await fs.writeFile(join(identity.project, "task.txt"), "human edit\n");
      tasks.merge.mockResolvedValue(null);
      const prepared = await controller.taskAction({ ...identity, type: "prepare", revisionId });
      const operationId = prepared.operation?.id;
      if (!operationId) throw new Error("Missing conflict preview");
      const internal = controller as unknown as {
        exclusive<T>(operation: () => Promise<T>): Promise<T>;
        chatExclusive<T>(session: ChatSession, operation: () => Promise<T>): Promise<T>;
        stopProject(): Promise<void>;
      };
      const chatExclusive = internal.chatExclusive.bind(internal);
      let cleanup: Promise<void> | undefined;
      vi.spyOn(internal, "chatExclusive").mockImplementationOnce((session, operation) => {
        cleanup = internal.exclusive(() => internal.stopProject());
        return chatExclusive(session, operation);
      });
      await expect(
        controller.taskAction({ ...identity, type: "revise", operationId }),
      ).rejects.toThrow("stopping");
      expect(cleanup).toBeDefined();
      await cleanup;
      const review = await controller.readReview({ ...identity, requestId: randomUUID() });
      expect(review.comments).toEqual([]);
      expect(review.submissions).toEqual([]);
      expect(await fs.readFile(join(identity.project, "task.txt"), "utf8")).toBe("human edit\n");
    });
  });

  it("groups workers by human request and delivers review feedback once between turns without restoring ownership", async () => {
    const { call, scope } = await setup();
    Object.assign(git, {
      reviewSnapshot: async () => ({
        files: [
          {
            path: "same.ts",
            oldPath: "same.ts",
            status: "modified",
            original: "before\n",
            modified: "after\n",
            fingerprint: "version-one",
          },
        ],
        truncated: false,
      }),
    });
    const chatId = controller.snapshot().chat.run?.id as string;
    await controller.orchestrationChatAction({
      type: "send",
      id: chatId,
      text: "Implement validation",
    });
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
    const first = await dispatch(call, scope, "HANG one", "review-one");
    const second = await dispatch(call, scope, "HANG two", "review-two");
    await vi.waitFor(
      () => {
        const review = controller.snapshot().reviews?.[0];
        expect(review?.revisions.length).toBeGreaterThan(0);
      },
      { timeout: 5_000 },
    );
    const summary = controller.snapshot().reviews?.[0];
    if (!summary) throw new Error("Missing review");
    expect(controller.snapshot().reviews).toHaveLength(1);
    expect(summary.workers.map((worker) => worker.runId)).toEqual([first, second]);
    expect(summary.title).toBe("Implement validation");
    const project = controller.snapshot().directory as string;
    const identity = { project, reviewId: summary.id };
    const review = await controller.readReview({ ...identity, requestId: randomUUID() });
    const revision = review.revisions.at(-1);
    if (!revision) throw new Error("Missing revision");
    const commentId = randomUUID();
    await controller.reviewAction({
      type: "comment",
      ...identity,
      id: commentId,
      revisionId: revision.id,
      text: "Allow optional fields",
      anchor: {
        revisionId: revision.id,
        fileKey: `${first}:same.ts`,
        side: "modified",
        start: 1,
        end: 1,
      },
    });
    await controller.orchestrationChatAction({
      type: "send",
      id: chatId,
      text: "HANG while reviewing",
    });
    expect(
      (await call("code60_read_review", { reviewId: summary.id })).body.result.comments,
    ).toEqual([]);
    const batchId = randomUUID();
    await controller.reviewAction({
      type: "submit",
      ...identity,
      id: batchId,
      revisionId: revision.id,
    });
    expect(controller.snapshot().reviews?.[0]?.submissions[0]?.state).toBe("pending");
    await controller.orchestrationChatAction({ type: "cancel", id: chatId });
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
    expect(controller.snapshot().reviews?.[0]?.submissions[0]?.state).toBe("pending");
    await controller.orchestrationChatAction({ type: "resume-updates", id: chatId });
    await vi.waitFor(() =>
      expect(controller.snapshot().reviews?.[0]?.submissions[0]?.state).toBe("delivered"),
    );
    await controller.reviewAction({
      type: "submit",
      ...identity,
      id: batchId,
      revisionId: revision.id,
    });
    expect(chatPrompts().filter((text) => text.includes(`submission ${batchId}`))).toHaveLength(1);
    expect(
      (
        await call("code60_address_feedback", {
          scope,
          reviewId: summary.id,
          commentId,
          note: "Changed optional fields",
        })
      ).status,
    ).toBe(200);
    expect(
      (await controller.readReview({ ...identity, requestId: randomUUID() })).comments[0],
    ).toMatchObject({ state: "sent", addressed: "Changed optional fields" });
    await controller.orchestrationChatAction({ type: "new" });
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
    const other = caller(3);
    expect((await other("code60_read_review", { reviewId: summary.id })).status).not.toBe(200);
    await controller.reviewAction({
      type: "reconnect",
      ...identity,
      chatId: controller.snapshot().chat.run?.id as string,
    });
    const otherScope = (await other("code60_get_context")).body.result.scope;
    expect(
      (await other("code60_send_agent", { scope: otherScope, runId: first, prompt: "Fix it" })).body
        .error,
    ).toContain("No worker");
  });

  it("gives dispatched and explicitly recovered workers current configured servers, never the chat gateway", async () => {
    const first = await configureMcp();
    const { call, scope } = await setup();
    const runId = await dispatch(call, scope, "first worker");
    await vi.waitFor(() => expect(session(runId)?.prompts).toEqual(["first worker"]));
    expect(agents.specs.find((spec) => spec.cwd.endsWith(runId))?.mcpServers).toEqual(first);
    const next = await configureMcp("next");
    expect(agents.specs[0]?.mcpServers).toEqual([
      ...first,
      expect.objectContaining({ name: "code60" }),
    ]);
    await call("code60_finish_agent", { scope, runId });
    await vi.waitFor(() =>
      expect(controller.snapshot().runs.find((run) => run.record.id === runId)?.record.status).toBe(
        "finished",
      ),
    );
    expect((await call("code60_resume_agent", { scope, runId, prompt: "continue" })).status).toBe(
      200,
    );
    expect(agents.restores.at(-1)?.spec.mcpServers).toEqual(next);
    await vi.waitFor(() =>
      expect(controller.snapshot().runs.find((run) => run.record.id === runId)?.view?.status).toBe(
        "idle",
      ),
    );
    expect((await call("code60_finish_agent", { scope, runId })).status).toBe(200);
    await vi.waitFor(() =>
      expect(controller.snapshot().runs.find((run) => run.record.id === runId)?.record.status).toBe(
        "finished",
      ),
    );
    agents.restoreUnavailable = true;
    expect((await call("code60_resume_agent", { scope, runId, prompt: "handoff" })).status).toBe(
      200,
    );
    expect(agents.specs.at(-1)?.mcpServers).toEqual(next);
    expect(JSON.stringify(controller.snapshot())).not.toContain("private-next");
  });

  it.each(["droid", "codex"])(
    "defaults workers to the selected %s provider, not the CLI default",
    async (provider) => {
      agents.script = () => "hang";
      await setProvider(provider);
      await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
      await controller.open(directory);
      const call = caller();
      const context = await call("code60_get_context");
      const scope = context.body.result.scope;
      const runId = await dispatch(call, scope, "HANG default worker");
      await vi.waitFor(() => expect(session(runId)).toBeDefined());
      expect(controller.snapshot().runs.find((run) => run.record.id === runId)?.record.agent).toBe(
        provider,
      );
      expect(agents.specs.find((spec) => spec.cwd.endsWith(runId))?.command).toEqual(
        DEFAULT_CONFIG.agents[provider]?.command,
      );
      expect(context.body.result.defaultProvider).toBe(provider);
      expect(controller.snapshot().defaultAgent).toBe(provider);

      const override = await call("code60_dispatch_agent", {
        scope,
        requestId: "explicit provider",
        prompt: "HANG explicit worker",
        provider: "claude",
      });
      expect(override.status).toBe(200);
      const overrideId = override.body.result.runId;
      await vi.waitFor(() => expect(session(overrideId)).toBeDefined());
      expect(
        controller.snapshot().runs.find((run) => run.record.id === overrideId)?.record.agent,
      ).toBe("claude");
      expect(agents.specs.find((spec) => spec.cwd.endsWith(overrideId))?.command).toEqual(
        DEFAULT_CONFIG.agents.claude?.command,
      );
    },
  );

  it("does not fall back to the CLI default when the selected worker provider disappears", async () => {
    const configDirectory = join(directory, "config", "code60");
    const configPath = join(configDirectory, "config.json");
    await fs.mkdir(configDirectory, { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({ agents: { custom: { command: ["custom-agent", "acp"] } } }),
    );
    await controller.poll(["config"]);
    await setProvider("custom");
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
    await controller.open(directory);
    const call = caller();
    const context = await call("code60_get_context");
    expect(context.body.result.defaultProvider).toBe("custom");
    await fs.writeFile(configPath, "{}");
    const before = agents.specs.length;
    const result = await call("code60_dispatch_agent", {
      scope: context.body.result.scope,
      requestId: "missing provider",
      prompt: "Do not launch another provider",
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain("Complete agent setup first");
    expect(agents.specs).toHaveLength(before);
  });

  it("isolates gateways, ownership, request IDs, capacity and updates across chats", async () => {
    await fs.mkdir(join(directory, "config", "code60"), { recursive: true });
    await fs.writeFile(
      join(directory, "config", "code60", "config.json"),
      JSON.stringify({ maxParallel: 1 }),
    );
    await controller.poll(["config"]);
    const { call: firstCall, scope: firstScope } = await setup(1);
    const firstId = controller.snapshot().chat.run?.id as string;
    await controller.orchestrationChatAction({ type: "new" });
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
    const secondCall = caller(1);
    const secondScope = (await secondCall("code60_get_context")).body.result.scope;
    expect(secondScope).not.toBe(firstScope);
    const firstWorker = await dispatch(firstCall, firstScope, "HANG first", "shared-id");
    const secondWorker = await dispatch(secondCall, secondScope, "HANG second", "shared-id");
    expect(firstWorker).not.toBe(secondWorker);
    expect(controller.snapshot().chats.find((chat) => chat.run?.id === firstId)?.workers).toEqual([
      firstWorker,
    ]);
    expect(controller.snapshot().chat.workers).toEqual([secondWorker]);
    expect((await firstCall("code60_get_context")).body.result.liveWorkers).toBe(1);
    expect((await secondCall("code60_get_context")).body.result.liveWorkers).toBe(1);
    expect((await firstCall("code60_list_agents")).body.result.workers).toEqual([
      expect.objectContaining({ runId: firstWorker }),
    ]);
    expect((await secondCall("code60_list_agents")).body.result.workers).toEqual([
      expect.objectContaining({ runId: secondWorker }),
    ]);
    expect((await secondCall("code60_read_agent", { runId: firstWorker })).status).toBe(400);
    expect(
      (
        await secondCall("code60_stop_agent", {
          scope: firstScope,
          runId: firstWorker,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await secondCall("code60_stop_agent", {
          scope: secondScope,
          runId: firstWorker,
        })
      ).status,
    ).toBe(400);

    await vi.waitFor(() => expect(session(firstWorker)?.turnActive).toBe(true));
    session(firstWorker)?.update({ type: "message", text: "first worker reply" });
    session(firstWorker)?.endTurn("end_turn");
    await vi.waitFor(() => expect(agents.sessions[0]?.prompts).toHaveLength(1));
    expect(agents.sessions[0]?.prompts[0]).toContain("first worker reply");
    expect(agents.sessions[1]?.prompts).toEqual([]);
    await vi.waitFor(() => expect(session(secondWorker)?.turnActive).toBe(true));
    session(secondWorker)?.endTurn("end_turn");
    await vi.waitFor(() => expect(agents.sessions[1]?.prompts).toHaveLength(1));
    expect(agents.sessions[1]?.prompts[0]).toContain(secondWorker);
    expect(agents.sessions[1]?.prompts[0]).not.toContain(firstWorker);

    await controller.orchestrationChatAction({ type: "select", id: firstId });
    expect((await secondCall("code60_list_agents")).status).toBe(200);
    await controller.orchestrationChatAction({ type: "restart", id: firstId });
    await expect(firstCall("code60_get_context")).rejects.toThrow();
    expect((await secondCall("code60_list_agents")).status).toBe(200);
  });

  it("holds automatic worker updates during mode changes and keeps other actions responsive", async () => {
    const { call, scope } = await setup();
    const id = controller.snapshot().chat.run?.id as string;
    const primary = agents.sessions[0];
    if (!primary) throw new Error("Missing chat");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.assign(primary, { setMode: () => gate });
    primary.update({
      type: "sessionState",
      state: {
        model: null,
        usage: null,
        modes: {
          source: "config",
          confirmed: true,
          reportedAt: "2026-11-07T12:00:00.000Z",
          controls: [
            {
              id: "permissions",
              name: "Permissions",
              currentValue: "ask",
              options: [{ value: "ask", name: "Ask" }],
            },
          ],
        },
      },
    });
    const change = { source: "config" as const, configId: "permissions", value: "ask" };
    const pending = controller.orchestrationChatAction({ type: "set-mode", id, change });
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.modeChanging).toBe(true));
    try {
      const worker = await dispatch(call, scope, "Fix this while the mode RPC waits");
      await vi.waitFor(() => expect(controller.snapshot().chat.updates.pending).toBe(1));
      expect(chatPrompts()).toHaveLength(0);
      await expect(
        controller.orchestrationChatAction({ type: "send", id, text: "race" }),
      ).rejects.toThrow(/idle/);
      await expect(controller.action({ type: "set-mode", id, change })).rejects.toThrow(
        /Unknown run/,
      );
      await expect(
        controller.orchestrationChatAction({ type: "set-mode", id: worker, change }),
      ).rejects.toThrow(/no longer/);
      expect(
        await session(worker)?.requestPermission({
          toolCallId: "t",
          title: "Execute",
          kind: "execute",
        }),
      ).toBe("allow");
    } finally {
      release();
      await pending;
    }
    await vi.waitFor(() => expect(chatPrompts()).toHaveLength(1));
    expect(controller.snapshot().chat.updates.pending).toBe(0);
    await controller.orchestrationChatAction({ type: "stop", id });
    await expect(
      controller.orchestrationChatAction({ type: "set-mode", id, change }),
    ).rejects.toThrow(/idle/);
  });

  it("dispatches allow-all workers, wakes the chat once per worker turn, and labels it automatic", async () => {
    const { call, scope } = await setup();
    const runId = await dispatch(call, scope, "Fix the bug");
    await vi.waitFor(() => expect(session(runId)?.prompts).toEqual(["Fix the bug"]));
    const spec = agents.specs.find((entry) => entry.cwd.endsWith(runId));
    expect(spec?.mcpServers).toBeUndefined();
    expect(controller.snapshot().workers).toEqual([runId]);

    await vi.waitFor(() => expect(chatPrompts()).toHaveLength(1));
    const update = chatPrompts()[0] as string;
    expect(update).toContain("--- Automatic Code60 update (not written by the user) ---");
    expect(update).toContain(`Worker ${runId} (claude): idle after turn 1 (end_turn)`);
    expect(update).toContain("done: Fix the bug");
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
    const prompts = controller
      .snapshot()
      .chat.events.map(({ event }) => event)
      .filter((event) => event.type === "prompt");
    expect(prompts).toEqual([expect.objectContaining({ origin: "automatic" })]);

    expect(
      await session(runId)?.requestPermission({ toolCallId: "t", title: "rm", kind: "execute" }),
    ).toBe("allow");
    const listed = await call("code60_list_agents");
    expect(listed.body.result.workers).toEqual([
      expect.objectContaining({
        runId,
        status: "idle",
        turns: 1,
        actions: ["send", "finish", "stop"],
      }),
    ]);
    const read = await call("code60_read_agent", { runId });
    expect(read.body.result.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "prompt", text: "Fix the bug" }),
        expect.objectContaining({ type: "message", text: "done: Fix the bug" }),
        expect.objectContaining({ type: "permission", decision: "allowed", by: "policy" }),
      ]),
    );

    expect(
      (await call("code60_send_agent", { scope, runId, prompt: "Also add tests" })).status,
    ).toBe(200);
    await vi.waitFor(() => expect(chatPrompts()).toHaveLength(2));
    expect(chatPrompts()[1]).toContain("idle after turn 2");
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));

    expect((await call("code60_finish_agent", { scope, runId })).status).toBe(200);
    await vi.waitFor(() => expect(controller.active).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(chatPrompts()).toHaveLength(2);
  });

  it("rejects stale scopes, unknown arguments, manual sessions, and the chat itself", async () => {
    const { call, scope } = await setup();
    const [manual] = await controller.start({ ...request, prompt: "manual" });
    const chatId = controller.snapshot().chat.run?.id;
    for (const runId of [manual, chatId, "20260101-000000-abcdef"]) {
      const result = await call("code60_send_agent", { scope, runId, prompt: "x" });
      expect(result.status).toBe(400);
      expect(result.body.error).toContain("No worker with this ID");
    }
    expect(
      (await call("code60_dispatch_agent", { scope: "old", requestId: "a", prompt: "x" })).body
        .error,
    ).toContain("stale");
    expect(
      (await call("code60_dispatch_agent", { scope, requestId: "a", prompt: "x", command: "sh" }))
        .body.error,
    ).toBe("Unknown tool argument");
    expect(
      (
        await call("code60_dispatch_agent", {
          scope,
          requestId: "a",
          prompt: "x",
          provider: "nope",
        })
      ).body.error,
    ).toContain("not enabled");
    expect(
      (await call("code60_dispatch_agent", { scope, requestId: "a", prompt: " " })).status,
    ).toBe(400);
    await vi.waitFor(() =>
      expect(controller.snapshot().runs.find((run) => run.record.id === manual)?.view?.status).toBe(
        "idle",
      ),
    );
    await controller.action({ type: "finish", id: manual as string });
    await vi.waitFor(() => expect(controller.active).toBe(false));
    const other = join(directory, "other");
    await fs.mkdir(other);
    await controller.open(other);
    expect(
      (await call("code60_dispatch_agent", { scope, requestId: "b", prompt: "x" })).body.error,
    ).toContain("stale");
  });

  it("deduplicates request IDs and enforces the parallel limit until a worker is finished", async () => {
    await fs.mkdir(join(directory, "config", "code60"), { recursive: true });
    await fs.writeFile(
      join(directory, "config", "code60", "config.json"),
      JSON.stringify({ maxParallel: 1 }),
    );
    await controller.poll(["config"]);
    const { call, scope } = await setup(1);
    const first = await call("code60_dispatch_agent", { scope, requestId: "r1", prompt: "HANG" });
    const again = await call("code60_dispatch_agent", { scope, requestId: "r1", prompt: "HANG" });
    expect(again.body.result.runId).toBe(first.body.result.runId);
    expect(
      (await call("code60_dispatch_agent", { scope, requestId: "r1", prompt: "other" })).body.error,
    ).toContain("already used");
    const full = await call("code60_dispatch_agent", { scope, requestId: "r2", prompt: "two" });
    expect(full.body.error).toContain("All 1 worker slots are in use");
    const runId = first.body.result.runId as string;
    await vi.waitFor(() => expect(session(runId)?.turnActive).toBe(true));
    expect((await call("code60_finish_agent", { scope, runId })).body.error).toContain(
      "only an idle run",
    );
    expect((await call("code60_cancel_agent", { scope, runId })).status).toBe(200);
    await vi.waitFor(() => expect(controller.snapshot().runs[0]?.view?.status).toBe("idle"));
    expect((await call("code60_finish_agent", { scope, runId })).status).toBe(200);
    await vi.waitFor(() => expect(controller.active).toBe(false));
    expect(
      (await call("code60_dispatch_agent", { scope, requestId: "r2", prompt: "two" })).status,
    ).toBe(200);
    await vi.waitFor(() => expect(agents.sessions).toHaveLength(3));
  });

  it("wakes the chat when a worker fails before its first turn", async () => {
    const { call, scope } = await setup();
    agents.startError = new Error("Worker authentication required");
    const runId = await dispatch(call, scope, "start work");
    await vi.waitFor(() => expect(chatPrompts()).toHaveLength(1));
    expect(chatPrompts()[0]).toContain(`Worker ${runId} (claude): failed after turn 0`);
    expect(chatPrompts()[0]).toContain("Worker authentication required");
  });

  it("coalesces updates while the chat is busy and pauses them after Stop", async () => {
    const { call, scope } = await setup();
    const chatId = controller.snapshot().chat.run?.id as string;
    await controller.orchestrationChatAction({ type: "send", id: chatId, text: "HANG please" });
    const one = await dispatch(call, scope, "one");
    const two = await dispatch(call, scope, "two");
    await vi.waitFor(() =>
      expect(controller.snapshot().chat.updates).toEqual({ paused: false, pending: 2 }),
    );
    agents.sessions[0]?.endTurn("end_turn");
    await vi.waitFor(() => expect(chatPrompts()).toHaveLength(2));
    expect(chatPrompts()[1]).toContain(`Worker ${one}`);
    expect(chatPrompts()[1]).toContain(`Worker ${two}`);
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));

    await controller.orchestrationChatAction({ type: "send", id: chatId, text: "HANG again" });
    await call("code60_send_agent", { scope, runId: one, prompt: "more" });
    await vi.waitFor(() => expect(controller.snapshot().chat.updates.pending).toBe(1));
    await controller.orchestrationChatAction({ type: "cancel", id: chatId });
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(controller.snapshot().chat.updates).toEqual({ paused: true, pending: 1 });
    expect(chatPrompts()).toHaveLength(3);
    await controller.orchestrationChatAction({ type: "resume-updates", id: chatId });
    await vi.waitFor(() => expect(chatPrompts()).toHaveLength(4));
    expect(chatPrompts()[3]).toContain(`Worker ${one} (claude): idle after turn 2`);
  });

  it("stops and resumes owned workers with allow-all, and revokes tools when the chat is replaced", async () => {
    const { call, scope } = await setup();
    const runId = await dispatch(call, scope, "HANG work");
    await vi.waitFor(() => expect(session(runId)?.turnActive).toBe(true));
    expect((await call("code60_stop_agent", { scope, runId })).status).toBe(200);
    await vi.waitFor(() => expect(controller.active).toBe(false));
    await controller.poll(["history"]);
    await vi.waitFor(() => expect(chatPrompts().at(-1)).toContain("cancelled after turn 1"));
    const listed = await call("code60_list_agents");
    expect(listed.body.result.workers[0]).toMatchObject({
      status: "cancelled",
      actions: ["resume"],
    });
    const resumed = await call("code60_resume_agent", { scope, runId, prompt: "continue" });
    expect(resumed.body.result).toMatchObject({ recovery: "restored" });
    expect(agents.restores.at(-1)?.sessionId).toBe(session(runId)?.sessionId);
    const restored = agents.sessions.at(-1);
    await vi.waitFor(() => expect(restored?.prompts).toEqual(["continue"]));
    expect(
      await restored?.requestPermission({ toolCallId: "t", title: "x", kind: "execute" }),
    ).toBe("allow");

    await setProvider("codex");
    await vi.waitFor(() => expect(chatStatus()).toBe("idle"));
    await expect(call("code60_list_agents")).rejects.toThrow();
    const next = caller(agents.specs.findLastIndex((spec) => spec.mcpServers !== undefined));
    const context = await next("code60_get_context");
    expect(context.body.result.scope).not.toBe(scope);
    expect(
      (await next("code60_finish_agent", { scope: context.body.result.scope, runId })).body.error,
    ).toContain("No worker with this ID");
    expect(controller.snapshot().workers).toContain(runId);
    expect(controller.snapshot().chat.workers).toEqual([]);
  });
});

describe("episodic memory controller", () => {
  async function prepare() {
    const id = await start("Use npm for the project.");
    await controller.action({ type: "finish", id });
    await vi.waitFor(() => expect(controller.snapshot().active).toBe(false));
    await setProvider("claude");
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    const events = await controller.action({ type: "events", id });
    if (!Array.isArray(events)) throw new Error("Missing fixture events");
    return {
      requestId: crypto.randomUUID(),
      directory: await realOf(directory),
      prompt: "Remember decisions",
      runs: [{ id, count: events.length }],
    };
  }

  it("uses the selected event snapshot and a temporary directory, leaving chat and runs unchanged", async () => {
    await configureMcp();
    const request = await prepare();
    expect(request.runs[0]?.count).toBeGreaterThan(2);
    request.runs = request.runs.map((run) => ({ ...run, count: 2 }));
    const before = controller.snapshot();
    agents.script = (_, session) => {
      session.update({ type: "message", text: '{"statements":["The project uses npm."]}' });
      return "end_turn";
    };
    const result = await controller.extractMemory(request);
    expect(result).toEqual({
      eventCount: request.runs[0]?.count,
      statements: ["The project uses npm."],
    });
    expect(controller.snapshot().runs.map((run) => run.record.id)).toEqual(
      before.runs.map((run) => run.record.id),
    );
    expect(controller.snapshot().chat.run?.id).toBe(before.chat.run?.id);
    const excerpt = agents.sessions
      .at(-1)
      ?.prompts[0]?.split("--- Recorded events ---\n\n")[1]
      ?.split("\n\n--- End recorded events ---")[0];
    expect(
      excerpt
        ?.trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toHaveLength(2);
    const spec = agents.specs.at(-1);
    expect(spec?.cwd).toContain("code60-memory-");
    expect(spec?.mcpServers).toBeUndefined();
    await expect(fs.stat(spec?.cwd ?? "")).rejects.toThrow();
  });

  it("rejects stale projects, foreign sessions, and unavailable event counts", async () => {
    const request = await prepare();
    const starts = agents.sessions.length;
    await expect(controller.extractMemory({ ...request, directory: "/other" })).rejects.toThrow(
      "project changed",
    );
    await expect(
      controller.extractMemory({ ...request, runs: [{ id: "foreign", count: 1 }] }),
    ).rejects.toThrow("open project");
    await expect(
      controller.extractMemory({
        ...request,
        runs: [{ id: request.runs[0]?.id as string, count: 9999 }],
      }),
    ).rejects.toThrow("Events changed");
    expect(agents.sessions).toHaveLength(starts);
  });

  it.each(["cancel", "provider", "project", "stop all", "shutdown"])(
    "cancels and cleans up extraction on %s",
    async (action) => {
      const request = await prepare();
      agents.script = () => "hang";
      const starts = agents.sessions.length;
      const pending = controller.extractMemory(request);
      const rejected = expect(pending).rejects.toThrow("cancelled");
      await vi.waitFor(() => expect(agents.sessions.length).toBe(starts + 1));
      await expect(
        controller.extractMemory({ ...request, requestId: crypto.randomUUID() }),
      ).rejects.toThrow("already running");
      await controller.cancelMemoryExtraction(crypto.randomUUID());
      expect(agents.sessions.at(-1)?.stops).toEqual([]);
      if (action === "cancel") await controller.cancelMemoryExtraction(request.requestId);
      else if (action === "provider") await setProvider(null);
      else if (action === "project") {
        await controller.open(directory);
      } else if (action === "stop all") await controller.stopAll();
      else await controller.shutdown();
      await rejected;
      expect(agents.sessions.at(-1)?.stops).toContain(1000);
      await expect(fs.stat(agents.specs.at(-1)?.cwd ?? "")).rejects.toThrow();
    },
  );
});

describe("search overview helpers", () => {
  async function summaryRequest() {
    await controller.open(directory);
    await setProvider("claude");
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    const path = controller.snapshot().directory as string;
    return {
      requestId: crypto.randomUUID(),
      directory: path,
      query: "parser",
      sources: [{ id: path, kind: "project" as const, title: "Project", text: "Parser fixed." }],
    };
  }

  it("uses the orchestration provider in a disposable directory without records or worktrees", async () => {
    await configureMcp();
    const input = { ...(await summaryRequest()), includeFiles: false };
    const initial = controller.snapshot();
    const count = agents.sessions.length;
    agents.script = (_, session) => {
      session.update({ type: "message", text: "Parser fixed. [1]" });
      return "end_turn";
    };
    expect(await controller.summarizeSearch(input)).toEqual({
      requestId: input.requestId,
      text: "Parser fixed. [1]",
      sources: input.sources,
    });
    expect(agents.sessions).toHaveLength(count + 1);
    const spec = agents.specs.at(-1);
    expect(spec?.name).toBe("claude");
    expect(spec?.mcpServers).toBeUndefined();
    expect(spec?.cwd).not.toBe(input.directory);
    await expect(fs.stat(spec?.cwd as string)).rejects.toThrow();
    expect(agents.sessions.at(-1)?.stops).toEqual([1000]);
    expect(controller.snapshot().runs).toEqual(initial.runs);
    expect(controller.snapshot().chats).toEqual(initial.chats);
    expect(git.worktrees).toEqual([]);
  });

  it("starts a worker for a natural-language question with no matching saved sessions", async () => {
    const input = await summaryRequest();
    await fs.writeFile(
      join(directory, "README.md"),
      "This project builds accessible color palettes.",
    );
    agents.script = (prompt, session) => {
      expect(prompt).toContain("This project builds accessible color palettes.");
      session.update({ type: "message", text: "It builds accessible color palettes. [1]" });
      return "end_turn";
    };
    const result = await controller.summarizeSearch({
      ...input,
      query: "What is this project about?",
      sources: [],
    });
    expect(result.text).toContain("color palettes");
    expect(result.sources[0]).toMatchObject({ kind: "file", path: "README.md" });
    expect(controller.snapshot().runs).toHaveLength(0);
  });

  it("rejects stale projects, foreign sessions and malformed source addresses", async () => {
    const input = await summaryRequest();
    await expect(controller.summarizeSearch({ ...input, directory: "/elsewhere" })).rejects.toThrow(
      "project changed",
    );
    for (const source of [
      { id: "/elsewhere", kind: "project" as const, title: "Project", text: "" },
      { id: "foreign", kind: "run" as const, title: "Foreign", text: "", runId: "foreign" },
      {
        id: "foreign:0",
        kind: "message" as const,
        title: "Foreign",
        text: "",
        runId: "foreign",
        eventIndex: 0,
      },
    ])
      await expect(controller.summarizeSearch({ ...input, sources: [source] })).rejects.toThrow(
        "source",
      );
  });

  it("fully stops a superseded worker before starting the replacement and ignores stale cancellation", async () => {
    const input = await summaryRequest();
    agents.script = () => "hang";
    const first = controller.summarizeSearch(input);
    const rejected = expect(first).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(agents.sessions.at(-1)?.turnActive).toBe(true));
    const oldSession = agents.sessions.at(-1);
    const oldDirectory = agents.specs.at(-1)?.cwd as string;
    agents.script = (_, session) => {
      expect(oldSession?.stops).toEqual([1000]);
      session.update({ type: "message", text: "Replacement. [1]" });
      return "end_turn";
    };
    const next = { ...input, requestId: crypto.randomUUID() };
    expect((await controller.summarizeSearch(next)).text).toBe("Replacement. [1]");
    await rejected;
    await expect(fs.stat(oldDirectory)).rejects.toThrow();
    await controller.cancelSearchSummary(input.requestId);
  });

  it.each(["cancel", "reload", "provider", "project", "database", "stop-all", "shutdown"])(
    "cancels and cleans up on %s",
    async (mode) => {
      const input = await summaryRequest();
      agents.script = () => "hang";
      const pending = controller.summarizeSearch(input);
      const rejected = expect(pending).rejects.toThrow("cancelled");
      await vi.waitFor(() => expect(agents.sessions.at(-1)?.turnActive).toBe(true));
      const worker = agents.sessions.at(-1);
      const cwd = agents.specs.at(-1)?.cwd as string;
      if (mode === "cancel") await controller.cancelSearchSummary(input.requestId);
      else if (mode === "reload") await controller.cancelSearchSummary();
      else if (mode === "provider") await setProvider(null);
      else if (mode === "project") {
        const next = join(directory, "next-project");
        await fs.mkdir(next);
        await controller.open(next);
      } else if (mode === "database")
        await controller.connect(join(directory, "next.sqlite"), true);
      else if (mode === "stop-all") await controller.stopAll();
      else await controller.shutdown(true);
      await rejected;
      expect(worker?.stops).toEqual([1000]);
      await expect(fs.stat(cwd)).rejects.toThrow();
    },
  );

  it("does not cancel the active worker for another request ID", async () => {
    const input = await summaryRequest();
    agents.script = () => "hang";
    const pending = controller.summarizeSearch(input);
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(agents.sessions.at(-1)?.turnActive).toBe(true));
    await controller.cancelSearchSummary(crypto.randomUUID());
    expect(agents.sessions.at(-1)?.turnActive).toBe(true);
    await controller.cancelSearchSummary(input.requestId);
    await rejected;
  });
});

describe("independent diff reads", () => {
  function stallDiff() {
    let started = false;
    let completed = false;
    git.diff = async (_worktree, _base, signal) => {
      started = true;
      try {
        return await new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          if (signal?.aborted) reject(signal.reason);
        });
      } finally {
        completed = true;
      }
    };
    return { started: () => started, completed: () => completed };
  }

  it("keeps permission, cancellation, and ordinary chat actions responsive during a stalled diff", async () => {
    agents.script = () => "hang";
    const id = await start();
    await setProvider("claude");
    await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
    const stalled = stallDiff();
    const requestId = randomUUID();
    const diff = controller.readDiff({ requestId, id });
    const rejected = expect(diff).rejects.toThrow("cancelled");
    await vi.waitFor(() => expect(stalled.started()).toBe(true));
    await controller.action({ type: "reply", id, text: "work" });
    const answer = agents.sessions[0]?.requestPermission({
      toolCallId: "read",
      title: "command",
      kind: "execute",
    });
    await vi.waitFor(() => expect(controller.snapshot().runs[0]?.view?.pending).toHaveLength(1));
    const permission = controller.snapshot().runs[0]?.view?.pending[0];
    await controller.action({ type: "permission", id: permission?.id as string, answer: "allow" });
    expect(await answer).toBe("allow");
    await controller.action({ type: "cancel", id });
    await controller.orchestrationChatAction({
      type: "send",
      id: controller.snapshot().chat.run?.id as string,
      text: "hello",
    });
    expect(stalled.completed()).toBe(false);
    await controller.cancelDiff({ requestId });
    await rejected;
    expect(stalled.completed()).toBe(true);
  });

  it.each(["reload", "project", "database", "shutdown", "discard"] as const)(
    "cancels and settles reads on %s",
    async (mode) => {
      const id = await start();
      await controller.action({ type: "finish", id });
      await vi.waitFor(() => expect(controller.active).toBe(false));
      const stalled = stallDiff();
      const diff = controller.action({ type: "diff", id });
      const rejected = expect(diff).rejects.toThrow("cancelled");
      await vi.waitFor(() => expect(stalled.started()).toBe(true));
      if (mode === "reload") await controller.cancelDiffReads();
      if (mode === "project") await controller.open(directory);
      if (mode === "database") await controller.connect(join(directory, "second.sqlite"), true);
      if (mode === "shutdown") await controller.shutdown();
      if (mode === "discard") {
        const remove = git.removeWorktree.bind(git);
        git.removeWorktree = async (...args) => {
          expect(stalled.completed()).toBe(true);
          return remove(...args);
        };
        await controller.action({ type: "discard", id });
      }
      await rejected;
      expect(stalled.completed()).toBe(true);
    },
  );

  it("rejects unknown, discarded, and non-isolated runs", async () => {
    const id = await start();
    await expect(controller.readDiff({ requestId: randomUUID(), id: "unknown" })).rejects.toThrow(
      "Unknown run",
    );
    await controller.action({ type: "finish", id });
    await vi.waitFor(() => expect(controller.active).toBe(false));
    await controller.action({ type: "discard", id });
    await expect(controller.readDiff({ requestId: randomUUID(), id })).rejects.toThrow("discarded");
    const workspace = await openWorkspace(controllerDeps(), directory, {
      XDG_STATE_HOME: join(directory, "state"),
    });
    const original = await workspace.store.read(id);
    const { discardedAt: _discarded, ...record } = original;
    await workspace.store.save({ ...record, base: null, branch: null });
    await controller.open(directory);
    await expect(controller.readDiff({ requestId: randomUUID(), id })).rejects.toThrow(
      "no separate diff",
    );
  });
});
