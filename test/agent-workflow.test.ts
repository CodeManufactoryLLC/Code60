import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, defaultDeps } from "../src/core/index.js";
import { RelayService } from "../src/desktop/relay-service.js";
import { commitFixture } from "./fixtures/git-repository.js";

const required = <T>(value: T | undefined | null): T => {
  if (value == null) throw new Error("Missing workflow fixture value");
  return value;
};

// Supporting integration, not UI E2E: validates the real provider subprocess and
// production plan/Git/review path without claiming onboarding or renderer coverage.
it.each(["readable", "legacy"] as const)(
  "supports the %s fake-provider request through plan acceptance, automatic edits and message Undo",
  async (format) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "code60-workflow-integration-")));
    const repo = join(root, "target with spaces");
    const processLog = join(root, "processes");
    await mkdir(repo);
    await mkdir(processLog);
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8", timeout: 10_000 });
    git("init", "-q", "-b", "main");
    git("config", "core.autocrlf", "false");
    await writeFile(join(repo, "result.txt"), "original\n");
    await writeFile(join(repo, "notes.txt"), "committed notes\n");
    git("add", ".");
    commitFixture(repo);
    await writeFile(join(repo, "notes.txt"), "staged notes\n");
    git("add", "notes.txt");
    await writeFile(join(repo, "notes.txt"), "unstaged notes\n");
    const staged = git("diff", "--cached", "--binary");
    const entries = git("ls-files", "--stage", "-z");
    const index = await readFile(join(repo, ".git/index"));
    const head = git("rev-parse", "HEAD");
    const confirm = vi.fn(async () => false);
    const service = new RelayService(
      defaultDeps(),
      { XDG_STATE_HOME: join(root, "state") },
      () => {},
      { confirm },
    );
    const command: [string, ...string[]] = [
      process.execPath,
      resolve(import.meta.dirname, "fixtures/fake-agent.mjs"),
      "--relay",
      "--process-log",
      processLog,
    ];
    try {
      await service.sync("claude", {
        ...DEFAULT_CONFIG,
        agents: { claude: { ...required(DEFAULT_CONFIG.agents.claude), command } },
      });
      await vi.waitFor(() => expect(service.snapshot().run?.status).toBe("idle"), {
        timeout: 10_000,
      });
      await service.action({
        type: "send",
        id: required(service.snapshot().run?.id),
        text:
          format === "readable"
            ? `Plan a change in ${repo}\nCreate result.txt containing "human accepted target" followed by a newline. Use an isolated worktree and wait for my approval.`
            : `Relay plan: ${JSON.stringify({ cwd: repo, workspaceMode: "worktree" })}`,
      });
      await vi.waitFor(
        () => {
          expect(service.snapshot().plans).toHaveLength(1);
          expect(service.snapshot().run?.status).toBe("idle");
        },
        { timeout: 10_000 },
      );
      expect(service.workerSnapshot().runs).toEqual([]);
      expect(git("worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
      const plan = await service.readPlan({
        chatId: required(service.snapshot().conversationId),
        planId: required(service.snapshot().plans?.[0]?.id),
      });
      expect(plan.state).toBe("draft");
      await service.planAction({
        type: "accept",
        chatId: plan.chatId,
        planId: plan.id,
        revision: plan.revision,
      });
      await vi.waitFor(
        () => {
          expect(service.workerSnapshot().runs).toHaveLength(1);
          expect(service.workerSnapshot().runs[0]?.view?.status).toBe("idle");
        },
        { timeout: 10_000 },
      );
      const worker = required(service.workerSnapshot().runs[0]);
      const worktree = worker.record.worktree;
      expect(await readFile(join(worktree, "result.txt"), "utf8")).toBe("human accepted target\n");
      await vi.waitFor(
        async () =>
          expect(await readFile(join(repo, "result.txt"), "utf8")).toBe("human accepted target\n"),
        { timeout: 10_000 },
      );
      expect(confirm).not.toHaveBeenCalled();
      const provenance = required(worker.relay);
      const address = {
        conversationId: provenance.conversationId,
        generation: provenance.generation,
        targetId: provenance.targetId,
        reviewId: required(provenance.reviewId),
      };
      const captured = await service.reviewRequest({
        type: "read",
        ...address,
        requestId: randomUUID(),
      });
      if (captured.type !== "review") throw new Error("No captured review");
      const revision = required(captured.review.revisions.at(-1));
      expect(revision.files.map((file) => file.path)).toEqual(["result.txt"]);
      const request = {
        type: "undo-request" as const,
        id: required(service.snapshot().run?.id),
        checkpointId: required(service.snapshot().checkpoint?.id),
        replacesDraft: false,
      };
      expect(await service.action(request)).toBeUndefined();
      expect(await readFile(join(repo, "result.txt"), "utf8")).toBe("human accepted target\n");
      expect(git("diff", "--cached", "--binary")).toBe(staged);
      expect(git("ls-files", "--stage", "-z")).toBe(entries);
      confirm.mockResolvedValue(true);
      expect(await service.action(request)).toMatchObject({
        type: "rewound",
        checkpointId: request.checkpointId,
      });
      expect(await readFile(join(repo, "result.txt"), "utf8")).toBe("original\n");
      expect(await readFile(join(repo, "notes.txt"), "utf8")).toBe("unstaged notes\n");
      expect(git("show", ":notes.txt")).toBe("staged notes\n");
      expect(git("diff", "--cached", "--binary")).toBe(staged);
      expect(git("ls-files", "--stage", "-z")).toBe(entries);
      expect(await readFile(join(repo, ".git/index"))).toEqual(index);
      expect(git("rev-parse", "HEAD")).toBe(head);
      expect(await readFile(join(worktree, "result.txt"), "utf8")).toBe("human accepted target\n");
      expect(confirm.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
        "Undo this request?",
        "Undo this request?",
      ]);
      expect(service.workerSnapshot().runs).toHaveLength(0);
      expect(service.snapshot().plans).toHaveLength(0);
    } finally {
      await service.shutdown(true);
      const evidence = await Promise.all(
        (await readdir(processLog)).map(
          async (file) =>
            JSON.parse(await readFile(join(processLog, file), "utf8")) as { pid: number },
        ),
      );
      expect(evidence.length).toBeGreaterThanOrEqual(2);
      for (const { pid } of evidence) {
        expect(() => process.kill(pid, 0)).toThrow();
      }
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000,
);
