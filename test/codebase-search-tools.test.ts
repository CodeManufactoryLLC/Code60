import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSession, AgentSpec, Agents, PermissionHandler } from "../src/agents/index.js";
import {
  CodebaseIndexService,
  type CodebaseWorkerClient,
  composeSessionResources,
} from "../src/application/codebase-service.js";
import { CODEBASE_VECTOR_DIMENSIONS, CodebaseStore } from "../src/application/codebase-store.js";
import {
  type CodebaseFinalizeInput,
  type CodebaseIndexBatchInput,
  type CodebaseWorkerSearchInput,
  indexCodebaseBatch,
  searchCodebaseStore,
} from "../src/application/codebase-worker.js";
import {
  ApplicationHost,
  DesktopWorkflows,
  filePreferences,
  openProjectDatabase,
} from "../src/application/index.js";
import { createPromptActionHandler } from "../src/automation/executor.js";
import {
  CODEBASE_SEARCH_SERVER_NAME,
  type CodebaseSearchResult,
  mcpToolsForRole,
} from "../src/contracts/index.js";
import { defaultDeps, type RagEmbedder, WorkflowEngine } from "../src/core/index.js";
import { createMcpBroker } from "../src/gateway/mcp-broker.js";

const execFileAsync = promisify(execFile);
const dirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
  return stdout;
}

function fakeEmbedder(): RagEmbedder {
  const vectorFor = (text: string): Float32Array => {
    const v = new Float32Array(CODEBASE_VECTOR_DIMENSIONS);
    for (const word of text.toLowerCase().match(/[a-z0-9_]+/g) ?? ["empty"]) {
      let hash = 2166136261;
      for (let i = 0; i < word.length; i++) {
        hash ^= word.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      const bucket = Math.abs(hash) % CODEBASE_VECTOR_DIMENSIONS;
      v[bucket] = (v[bucket] ?? 0) + 1;
    }
    const norm = Math.hypot(...v) || 1;
    for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) / norm;
    return v;
  };
  return {
    countTokens: (text) => 2 + (text.trim() ? text.trim().split(/\s+/).length : 0),
    embedDocuments: async (texts) => texts.map(vectorFor),
    embedQuery: async (text) => vectorFor(text),
  };
}

function createInProcessWorker(dbPath: string, embedder: RagEmbedder): CodebaseWorkerClient {
  const store = new CodebaseStore(dbPath);
  return {
    async call<T>(op: string, args: unknown[]): Promise<T> {
      switch (op) {
        case "status":
          return store.getRepository(String(args[0])) as T;
        case "indexedFiles":
          return [...store.indexedFiles(String(args[0])).entries()] as T;
        case "upsertRepository":
          store.upsertRepository(args[0] as Parameters<CodebaseStore["upsertRepository"]>[0]);
          return null as T;
        case "markSync":
          return store.markSync(args[0] as Parameters<CodebaseStore["markSync"]>[0]) as T;
        case "chunkCount":
          return store.chunkCount(String(args[0])) as T;
        case "indexBatch":
          return (await indexCodebaseBatch(
            store,
            args[0] as CodebaseIndexBatchInput,
            async () => embedder,
          )) as T;
        case "finalizeCommit":
          return store.finalizeCommit(args[0] as CodebaseFinalizeInput) as T;
        case "search":
          return (await searchCodebaseStore(
            store,
            args[0] as CodebaseWorkerSearchInput,
            async () => embedder,
          )) as T;
        default:
          throw new Error(`Unknown op ${op}`);
      }
    },
    async close() {
      store.close();
    },
  };
}

async function createSampleRepo(): Promise<string> {
  const repo = await makeTempDir("code60-e2e-repo-");
  await git(["init", "-b", "main"], repo);
  await writeFile(
    join(repo, "engine.ts"),
    "export function computeQuantumSimilarity(a: number, b: number) {\n  return a * b;\n}\n",
  );
  await git(["add", "engine.ts"], repo);
  await git(["commit", "-m", "initial commit"], repo);
  return repo;
}

async function callBrokerTool(
  spec: AgentSpec,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const server = spec.mcpServers?.find((item) => item.name === CODEBASE_SEARCH_SERVER_NAME);
  if (!server || !("env" in server)) {
    throw new Error(`Missing ${CODEBASE_SEARCH_SERVER_NAME} MCP server descriptor`);
  }
  const env = Object.fromEntries(server.env.map((item) => [item.name, item.value]));
  const endpoint = env.CODE60_CONNECTOR_ENDPOINT;
  const token = env.CODE60_CONNECTOR_CAPABILITY;
  const owner = env.CODE60_CONNECTOR_OWNER;
  const response = await fetch(`${endpoint}/request`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Code60-Owner": owner ?? "",
    },
    body: JSON.stringify({ owner, method: "tools/call", name: toolName, arguments: args }),
  });
  expect(response.ok).toBe(true);
  const payload = (await response.json()) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  expect(payload.isError).toBe(false);
  return JSON.parse(payload.content[0]?.text ?? "{}");
}

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("vector codebase search tool exposure across all six surfaces", () => {
  it("exposes code60_search_codebase to Relay, Custom Assistants, Project Orchestrators, SubAgents, Workflow Engine, and Scheduled Agents", async () => {
    const repo = await createSampleRepo();
    const stateDir = await makeTempDir("code60-e2e-state-");
    const dbDir = await makeTempDir("code60-e2e-db-");
    const broker = await createMcpBroker();
    const embedder = fakeEmbedder();
    const baseDeps = defaultDeps();

    const service = new CodebaseIndexService(
      join(stateDir, "codebase-index"),
      stateDir,
      baseDeps.git,
      {
        fetchCooldownMs: 0,
        refreshIntervalMs: 0,
        worker: createInProcessWorker(join(stateDir, "index.sqlite"), embedder),
      },
    );

    try {
      // 1 & 2. Relay & Custom Assistants: exposed via `code60` MCP role `"relay"` requiring `cwd`.
      const relayTools = mcpToolsForRole("relay");
      expect(relayTools.some((tool) => tool.name === "code60_search_codebase")).toBe(true);
      expect(relayTools.some((tool) => tool.name === "code60_codebase_index_status")).toBe(true);
      const relayResult = (await service.callTool("relay", "code60_search_codebase", {
        cwd: repo,
        query: "computeQuantumSimilarity",
        limit: 5,
      })) as CodebaseSearchResult;
      expect(relayResult.status).toBe("ready");
      expect(relayResult.hits[0]?.path).toBe("engine.ts");
      await expect(
        service.callTool("relay", "code60_search_codebase", { query: "missing cwd" }),
      ).rejects.toThrow();

      // 3. Project Orchestrator Agents: exposed via `code60` MCP role `"project"` bound to project.
      const projectTools = mcpToolsForRole("project");
      expect(projectTools.some((tool) => tool.name === "code60_search_codebase")).toBe(true);
      const projectResult = (await service.callTool(
        "bound",
        "code60_search_codebase",
        { query: "computeQuantumSimilarity" },
        repo,
      )) as CodebaseSearchResult;
      expect(projectResult.hits[0]?.path).toBe("engine.ts");
      await expect(
        service.callTool(
          "bound",
          "code60_search_codebase",
          { cwd: repo, query: "should reject cwd" },
          repo,
        ),
      ).rejects.toThrow();

      // 4. SubAgents (Workers): attached via `composeSessionResources` + broker (`code60-code`).
      const workerFactory = composeSessionResources(
        undefined,
        service.sessionResources(repo, broker.expose),
      );
      expect(workerFactory).toBeDefined();
      const workerResource = await workerFactory!(
        {
          runId: "worker-1",
          provider: "fake",
          cwd: repo,
          controls: { idle: () => true, canRestore: () => false, reconnect: async () => {} },
        },
        undefined,
      );
      try {
        const subagentHit = (await callBrokerTool(
          { name: "fake", command: ["fake"], cwd: repo, mcpServers: workerResource.servers },
          "code60_search_codebase",
          { query: "computeQuantumSimilarity" },
        )) as CodebaseSearchResult;
        expect(subagentHit.hits[0]?.path).toBe("engine.ts");
      } finally {
        await workerResource.close();
      }

      // 5. Workflow Engine (worker & verifier sessions): receives `code60-code` bound to repo.
      const workflowStateDir = await makeTempDir("code60-wf-engine-");
      const seenSpecs: AgentSpec[] = [];
      let workflowToolResult: CodebaseSearchResult | undefined;
      const fakeWorkflowAgents: Agents = {
        async start(spec) {
          seenSpecs.push(spec);
          let handler: PermissionHandler | undefined;
          let updateListener: ((u: { type: "message"; text: string }) => void) | undefined;
          const exited = new Promise<void>(() => {});
          const session: AgentSession = {
            sessionId: `wf-sess-${seenSpecs.length}`,
            pid: process.pid,
            exited,
            async prompt() {
              // Verify built-in search tool works and auto-approves even when autoApprove=false!
              const perm = await handler?.(
                {
                  toolCallId: "tc-1",
                  title: "Search codebase",
                  kind: "other",
                  mcp: { server: CODEBASE_SEARCH_SERVER_NAME, tool: "code60_search_codebase" },
                  options: [
                    { optionId: "allow", name: "Allow", kind: "allow_once" },
                    { optionId: "deny", name: "Deny", kind: "reject_once" },
                  ],
                },
                new AbortController().signal,
              );
              expect(perm).toEqual({ optionId: "allow" });
              workflowToolResult = (await callBrokerTool(spec, "code60_search_codebase", {
                query: "computeQuantumSimilarity",
              })) as CodebaseSearchResult;
              const reply =
                seenSpecs.length === 1
                  ? JSON.stringify({ kind: "result", summary: "Checked engine.ts" })
                  : JSON.stringify({ kind: "verdict", decision: "accept", reason: "Verified" });
              updateListener?.({ type: "message", text: reply });
              return "end_turn";
            },
            async cancel() {},
            async stop() {},
            stderrTail: () => "",
            onUpdate(listener) {
              updateListener = listener as typeof updateListener;
              return () => {};
            },
            onPermission(fn) {
              handler = fn;
            },
          };
          return session;
        },
      };
      const engine = new WorkflowEngine(
        workflowStateDir,
        fakeWorkflowAgents,
        (_provider, cwd) => ({ name: "fake", command: ["fake"], cwd }),
        (repository) => service.sessionResources(repository, broker.expose),
      );
      try {
        const started = engine.start({
          repository: repo,
          provider: "fake",
          confirmed: true,
          idempotencyKey: "wf-codebase-test",
          autoApprove: false,
          tasks: [{ name: "Inspect", instructions: "Search engine.ts", verify: "Confirm match" }],
        });
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Workflow did not complete")), 10_000);
          const unwatch = engine.onRunChange((snap) => {
            if (snap.runId === started.runId && snap.status === "completed") {
              clearTimeout(timeout);
              unwatch();
              resolve();
            }
          });
          if (engine.status(started.runId).status === "completed") {
            clearTimeout(timeout);
            unwatch();
            resolve();
          }
        });
        expect(seenSpecs.length).toBeGreaterThanOrEqual(2);
        expect(
          seenSpecs.every((s) =>
            s.mcpServers?.some((srv) => srv.name === CODEBASE_SEARCH_SERVER_NAME),
          ),
        ).toBe(true);
        expect(workflowToolResult?.hits[0]?.path).toBe("engine.ts");
      } finally {
        await engine.close();
      }

      // 6. Scheduled Agents: receives `code60-code`, auto-allows built-in search, denies others!
      const schedEnv: NodeJS.ProcessEnv = {
        ...process.env,
        XDG_CONFIG_HOME: await makeTempDir("code60-sched-cfg-"),
        XDG_STATE_HOME: await makeTempDir("code60-sched-state-"),
      };
      let scheduledSearchResult: CodebaseSearchResult | undefined;
      let searchPermissionDecision: unknown;
      let shellPermissionDecision: unknown;
      const fakeScheduledAgents: Agents = {
        async start(spec) {
          let handler: PermissionHandler | undefined;
          let resolveExit!: () => void;
          const exited = new Promise<void>((r) => {
            resolveExit = r;
          });
          return {
            sessionId: "sched-sess-1",
            pid: process.pid,
            exited,
            async prompt() {
              searchPermissionDecision = await handler?.(
                {
                  toolCallId: "search-call",
                  title: "code60_search_codebase",
                  kind: "other",
                  mcp: { server: CODEBASE_SEARCH_SERVER_NAME, tool: "code60_search_codebase" },
                },
                new AbortController().signal,
              );
              shellPermissionDecision = await handler?.(
                {
                  toolCallId: "exec-call",
                  title: "Run shell command",
                  kind: "execute",
                },
                new AbortController().signal,
              );
              scheduledSearchResult = (await callBrokerTool(spec, "code60_search_codebase", {
                query: "computeQuantumSimilarity",
              })) as CodebaseSearchResult;
              return "end_turn";
            },
            async cancel() {},
            async stop() {
              resolveExit();
            },
            stderrTail: () => "",
            onUpdate: () => () => {},
            onPermission(fn) {
              handler = fn;
            },
          };
        },
      };
      const schedDeps = { ...baseDeps, agents: fakeScheduledAgents };
      const promptHandler = createPromptActionHandler(schedDeps, schedEnv, 1, {
        codeTools: (repository) => service.sessionResources(repository, broker.expose),
        onRepositoryActive: (repository) => service.trackRepository(repository),
      });
      const validated = await promptHandler.validate({
        type: "prompt",
        repository: repo,
        baseBranch: "main",
        agent: "claude",
        prompt: "Search for quantum similarity",
        allow: [],
        turnTimeout: "5m",
      });
      const claim = promptHandler.prepareClaim(validated, false);
      const outcome = await promptHandler.execute(
        {
          id: "00000000-0000-4000-8000-000000000001",
          revision: 1,
          name: "Nightly search",
          enabled: true,
          trigger: {
            type: "schedule",
            schedule: { type: "interval", everyMinutes: 60, anchor: new Date().toISOString() },
          },
          action: validated,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          nextRunAt: null,
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          sequence: 1,
          automationId: "00000000-0000-4000-8000-000000000001",
          automationName: "Nightly search",
          actionType: "prompt",
          revision: 1,
          trigger: "schedule",
          scheduledFor: new Date().toISOString(),
          claimedAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          endedAt: null,
          status: "claimed",
          reason: null,
          artifact: claim,
        },
        {
          signal: new AbortController().signal,
          abortKind: () => null,
          updateArtifact: async () => {},
          notify: () => {},
        },
      );
      expect(outcome.status).toBe("finished");
      expect(searchPermissionDecision).toBe("allow");
      expect(shellPermissionDecision).toBe("deny");
      expect(scheduledSearchResult?.hits[0]?.path).toBe("engine.ts");

      // Also verify ApplicationHost constructs codebase service & exposes sessionResources cleanly.
      const host = new ApplicationHost(
        baseDeps,
        { ...process.env, XDG_STATE_HOME: await makeTempDir("code60-host-state-") },
        { confirm: async () => true },
        {
          openDatabase: openProjectDatabase,
          preferences: filePreferences(join(dbDir, "desktop.json")),
          mcpRuntime: {
            connect: async () => {
              throw new Error("unused");
            },
            expose: broker.expose,
          },
          codebaseWorker: createInProcessWorker(join(dbDir, "host-codebase.sqlite"), embedder),
        },
      );
      try {
        expect(host.codebaseSessionResources(repo)).toBeDefined();
      } finally {
        await host.shutdown();
      }

      // Verify DesktopWorkflows accepts codebaseTools cleanly.
      const wfHost = new DesktopWorkflows(
        { ...process.env, XDG_STATE_HOME: await makeTempDir("code60-dwf-state-") },
        baseDeps,
        async () => null,
        async () => {
          throw new Error("unused");
        },
        {
          list: () => ({ providers: [], defaultProvider: null }),
          resolve: (_provider, cwd) => ({ name: "fake", command: ["fake"], cwd }),
        },
        {
          sessionResources: (repository) => service.sessionResources(repository, broker.expose),
          trackRepository: (repository) => service.trackRepository(repository),
        },
      );
      await wfHost.close();
    } finally {
      await service.close();
      await broker.close();
    }
  });

  it("allows closing the MCP broker more than once during quiesce and shutdown", async () => {
    const broker = await createMcpBroker();
    await broker.close();
    await expect(broker.close()).resolves.toBeUndefined();
  });
});
