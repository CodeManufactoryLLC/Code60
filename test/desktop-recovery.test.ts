import * as fs from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PromptTemplates } from "../src/bridge/index.js";
import { type CoreDeps, DEFAULT_CONFIG, openWorkspace, type RunRecord } from "../src/core/index.js";
import { DesktopController } from "../src/desktop/controller.js";
import type { DesktopPreferences } from "../src/desktop/preferences.js";
import type { ProjectDatabase } from "../src/desktop/projects.js";
import { FakeAgents, FakeClock, FakeGit, FakeProcesses, flush } from "./fakes.js";
import { verifiedAgents } from "./fixtures/verified-agents.js";

const dirs: string[] = [];
const controllers: DesktopController[] = [];

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.shutdown(true)));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(
  withSessionId: boolean,
  status: RunRecord["status"] = "interrupted",
  savedPrompts: Partial<PromptTemplates> = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "code60-recovery-"));
  dirs.push(dir);
  const agents = new FakeAgents(() => "hang");
  const git = new FakeGit();
  git.repoInfo = async () => ({ topLevel: dir, commonDir: join(dir, ".git") });
  const processes = new FakeProcesses();
  processes.alive.add(500);
  const deps: CoreDeps = {
    agents,
    git,
    fs: { ...fs } as unknown as CoreDeps["fs"],
    clock: new FakeClock(),
    processes,
    ownerPid: 500,
  };
  const env = { HOME: dir };
  const workspace = await openWorkspace(deps, dir, env);
  const record: RunRecord = {
    id: "run-1",
    agent: "claude",
    status,
    firstPrompt: "Change the implementation",
    turns: 1,
    base: "base-commit",
    branch: "code60/run-1",
    worktree: join(dir, "worktrees", "run-1"),
    ownerPid: 10,
    agentPid: 99,
    agentCommand: ["claude", "acp"],
    agentCommandLine: "claude acp",
    ...(withSessionId ? { acpSessionId: "saved-acp-id" } : {}),
    startedAt: "2026-01-01T00:00:00.000Z",
    ...(status === "interrupted" ? {} : { endedAt: "2026-01-01T00:05:00.000Z" }),
    reason: "the owning process is gone",
  };
  await workspace.store.save(record);
  await workspace.store.appendEvent({
    runId: record.id,
    at: record.startedAt,
    type: "prompt",
    turn: 1,
    text: record.firstPrompt,
  });

  const projects: { path: string; openedAt: string }[] = [];
  const database: ProjectDatabase = {
    path: join(dir, "db.sqlite"),
    list: () => [...projects],
    record(path, openedAt) {
      const existing = projects.find((entry) => entry.path === path);
      if (existing) existing.openedAt = openedAt;
      else projects.push({ path, openedAt });
    },
    remove(path) {
      const index = projects.findIndex((entry) => entry.path === path);
      if (index >= 0) projects.splice(index, 1);
    },
    clear() {
      projects.splice(0);
    },
    configurations: () => [],
    saveConfiguration() {},
    deleteConfiguration() {},
    useConfiguration() {},
    promptTemplates: () => ({ templates: { ...savedPrompts }, skipped: [] }),
    savePromptTemplate() {},
    deletePromptTemplate() {},
    close() {},
  };
  const preferences: DesktopPreferences = {
    read: async () => undefined,
    write: async () => {},
  };
  const controller = new DesktopController(
    deps,
    env,
    { confirm: async () => true },
    { openDatabase: () => database, preferences },
  );
  // biome-ignore lint/complexity/useLiteralKeys: Seed isolated post-setup lifecycle fixtures without exposing a production bypass.
  controller["agentSetup"].restore(verifiedAgents(DEFAULT_CONFIG));
  controllers.push(controller);
  await controller.connect(database.path, false);
  await controller.open(dir);
  return { controller, agents, processes, record, workspace, deps };
}

describe("desktop ended-run recovery", () => {
  it("waits for the final record before continuing one run while another stays idle", async () => {
    const { controller, agents, deps } = await setup(false);
    const [id, other] = await controller.start({
      agents: ["claude"],
      parallel: "2",
      allow: [],
      allowAll: false,
    });
    await expect
      .poll(() => controller.snapshot().runs.find((run) => run.record.id === id)?.view?.status)
      .toBe("idle");
    const rename = deps.fs.rename;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let saving = false;
    deps.fs.rename = async (from, to) => {
      const record = JSON.parse(await fs.readFile(from, "utf8")) as RunRecord;
      if (record.id === id && record.status === "finished") {
        saving = true;
        await gate;
      }
      await rename(from, to);
    };
    try {
      await controller.action({ type: "finish", id: id as string });
      await expect.poll(() => saving).toBe(true);
      const continued = controller
        .action({ type: "continue", id: id as string, text: "Continue" })
        .then(
          (result) => ({ result }),
          (error: unknown) => ({ error }),
        );
      await new Promise((resolve) => setTimeout(resolve, 30));
      release();
      await expect(continued).resolves.toEqual({ result: { type: "restored" } });
      expect(agents.restores).toHaveLength(1);
      expect(controller.snapshot().runs.find((run) => run.record.id === other)?.view?.status).toBe(
        "idle",
      );
    } finally {
      release();
    }
  });

  it("restores a finished run and sends only the new message", async () => {
    const { controller, agents, workspace, record } = await setup(true, "finished");

    await expect(
      controller.action({ type: "continue", id: record.id, text: "Add tests" }),
    ).resolves.toEqual({
      type: "restored",
    });

    expect(agents.restores).toHaveLength(1);
    await flush();
    expect(agents.sessions[0]?.prompts).toEqual(["Add tests"]);
    await expect.poll(async () => (await workspace.store.read(record.id)).status).toBe("running");
    expect(await workspace.store.readEvents(record.id)).toContainEqual(
      expect.objectContaining({ type: "note", text: "Reconnected to the earlier agent session." }),
    );
  });

  it.each(["missing session ID", "restore unavailable", "restore failed"])(
    "hands off with the new message when %s and preserves run identity",
    async (reason) => {
      const { controller, agents, workspace, record } = await setup(
        reason !== "missing session ID",
      );
      if (reason === "restore unavailable") agents.restoreUnavailable = true;
      if (reason === "restore failed") agents.restoreError = new Error("ACP connection failed");

      await expect(
        controller.action({ type: "continue", id: record.id, text: "Add tests" }),
      ).resolves.toEqual({
        type: "handoff-started",
      });
      await flush();

      const saved = await workspace.store.read(record.id);
      expect(agents.specs[0]?.cwd).toBe(record.worktree);
      expect(agents.sessions[0]?.prompts[0]).toContain("Inspect the worktree");
      expect(agents.sessions[0]?.prompts[0]).toContain("Change the implementation");
      expect(agents.sessions[0]?.prompts[0]).toContain("Add tests");
      expect(agents.sessions[0]?.prompts).toHaveLength(1);
      expect(await workspace.store.readEvents(record.id)).toContainEqual(
        expect.objectContaining({ type: "prompt", text: "Add tests", turn: 2 }),
      );
      expect(await workspace.store.readEvents(record.id)).toContainEqual(
        expect.objectContaining({
          type: "note",
          detail: expect.stringContaining("Inspect the worktree"),
        }),
      );
      expect(saved).toMatchObject({
        id: record.id,
        branch: record.branch,
        worktree: record.worktree,
        status: "running",
      });
      expect(controller.snapshot().runs[0]?.record.id).toBe(record.id);
    },
  );

  it("hands off with the prompt templates saved in the database", async () => {
    const { controller, agents, workspace, record } = await setup(false, "interrupted", {
      handoffSummary: "Summary for {{agent}} on {{branch}}",
      handoffTurn: "<<{{summary}}>> {{message}}",
    });
    await controller.action({ type: "continue", id: record.id, text: "Add tests" });
    await flush();
    expect(agents.sessions[0]?.prompts).toEqual([
      "<<Summary for claude on code60/run-1>> Add tests",
    ]);
    expect(await workspace.store.readEvents(record.id)).toContainEqual(
      expect.objectContaining({ type: "note", detail: "Summary for claude on code60/run-1" }),
    );
  });

  it("refuses recovery while the recorded agent process group is alive", async () => {
    const { controller, agents, processes, record } = await setup(true);
    processes.groups.add(record.agentPid as number);

    await expect(
      controller.action({ type: "continue", id: record.id, text: "Add tests" }),
    ).rejects.toThrow(/stop it before retrying/);
    expect(agents.restores).toHaveLength(0);
    expect(agents.specs).toHaveLength(0);
  });
});
