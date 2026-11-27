import { type ChildProcess, fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  type BoundCodebaseSearchArgs,
  CODEBASE_SEARCH_SERVER_NAME,
  type CodebaseFetchStatus,
  type CodebaseIndexProgress,
  type CodebaseIndexStatus,
  type CodebaseSearchResult,
  codebaseSearchToolsForRole,
  parseCodebaseSearchArgs,
  parseCodebaseStatusArgs,
} from "../bridge/index.js";
import {
  CODEBASE_LIMITS,
  type CodebaseGitOps,
  type CodebaseMainSnapshot,
  detectCodeLanguage,
  type Git,
  isIndexableCodeFile,
  type SessionResourceFactory,
} from "../core/index.js";
import { diagnosticText } from "../platform/index.js";
import {
  CODEBASE_CHUNKER_IDENTITY,
  CODEBASE_MODEL_IDENTITY,
  CODEBASE_MODEL_LABEL,
  type StoredRepository,
} from "./codebase-store.js";
import type {
  CodebaseFinalizeInput,
  CodebaseIndexBatchInput,
  CodebaseIndexBatchResult,
  CodebaseIndexFileInput,
  CodebaseWorkerSearchInput,
  CodebaseWorkerSearchOutput,
} from "./codebase-worker.js";
import type { McpRuntimePorts } from "./mcp-runtime.js";

const DEFAULT_FETCH_COOLDOWN_MS = 60_000;
const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60_000;
const DEFAULT_INLINE_WAIT_MS = 15_000;
const DEFAULT_REFRESH_WAIT_MS = 3_000;
const DEFAULT_IDLE_TIMEOUT_MS = 120_000;
const DEFAULT_CALL_TIMEOUT_MS = 120_000;
const FILE_BATCH_SIZE = 24;

export interface CodebaseWorkerClient {
  call<T>(op: string, args: unknown[], signal?: AbortSignal): Promise<T>;
  close(): Promise<void>;
}

export interface CodebaseServiceOptions {
  fetchCooldownMs?: number;
  refreshIntervalMs?: number;
  inlineWaitMs?: number;
  refreshWaitMs?: number;
  idleTimeoutMs?: number;
  worker?: CodebaseWorkerClient;
}

function repoKeyOf(commonDir: string): string {
  return createHash("sha256").update(commonDir).digest("hex");
}

function createSidecarClient(
  stateRoot: string,
  modelRoot: string,
  idleTimeoutMs: number,
): CodebaseWorkerClient {
  let child: ChildProcess | undefined;
  let booting: Promise<void> | undefined;
  let retiring: Promise<void> | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const requests = new Map<
    string,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  const armIdle = () => {
    clearTimeout(idle);
    if (requests.size > 0 || closed) return;
    idle = setTimeout(() => {
      const current = child;
      if (!current) return;
      child = undefined;
      retiring = new Promise<void>((resolve) => {
        const kill = setTimeout(() => current.kill("SIGKILL"), 1_000);
        current.once("exit", () => {
          clearTimeout(kill);
          resolve();
        });
        current.disconnect();
      }).finally(() => {
        retiring = undefined;
      });
    }, idleTimeoutMs);
    idle.unref();
  };

  const request = <T>(op: string, args: unknown[], signal?: AbortSignal): Promise<T> => {
    const current = child;
    if (!current?.connected) return Promise.reject(new Error("Codebase sidecar is unavailable"));
    if (signal?.aborted) return Promise.reject(new Error("Codebase operation cancelled"));
    clearTimeout(idle);
    return new Promise<T>((resolve, reject) => {
      const id = randomUUID();
      const onAbort = () => {
        const pending = requests.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        requests.delete(id);
        reject(new Error("Codebase operation cancelled"));
        armIdle();
      };
      const timer = setTimeout(() => {
        requests.delete(id);
        signal?.removeEventListener("abort", onAbort);
        reject(new Error("Codebase search operation timed out"));
        current.kill();
      }, DEFAULT_CALL_TIMEOUT_MS);
      requests.set(id, {
        resolve: (value) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(value as T);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
        timer,
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      current.send({ id, op, args }, (error) => {
        if (!error) return;
        const pending = requests.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        requests.delete(id);
        signal?.removeEventListener("abort", onAbort);
        reject(new Error("Could not send request to codebase sidecar"));
      });
    });
  };

  const ready = async (): Promise<void> => {
    await retiring;
    if (closed) throw new Error("Codebase search service is stopping");
    if (booting) return booting;
    if (child?.connected) return;
    const workerPath = fileURLToPath(new URL("./codebase-worker.js", import.meta.url));
    if (!existsSync(workerPath)) {
      throw new Error("Codebase indexing sidecar is unavailable");
    }
    const spawned = fork(workerPath, [], {
      execPath: process.execPath,
      execArgv: [],
      serialization: "advanced",
      env: { ...process.env },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    child = spawned;
    spawned.on("message", (message: { id?: string; error?: string; result?: unknown }) => {
      if (typeof message.id !== "string") return;
      const pending = requests.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      requests.delete(message.id);
      if (message.error) pending.reject(new Error(message.error));
      else pending.resolve(message.result);
      armIdle();
    });
    const failed = () => {
      if (child !== spawned) return;
      child = undefined;
      booting = undefined;
      for (const pending of requests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Codebase sidecar stopped"));
      }
      requests.clear();
    };
    spawned.once("error", failed);
    spawned.once("exit", failed);
    booting = request("init", [stateRoot, modelRoot])
      .then(() => {})
      .finally(() => {
        booting = undefined;
      });
    return booting;
  };

  return {
    async call<T>(op: string, args: unknown[], signal?: AbortSignal): Promise<T> {
      await ready();
      return request<T>(op, args, signal);
    },
    async close(): Promise<void> {
      closed = true;
      clearTimeout(idle);
      const current = child;
      child = undefined;
      for (const pending of requests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Codebase search service closed"));
      }
      requests.clear();
      if (current) {
        await new Promise<void>((resolve) => {
          const kill = setTimeout(() => current.kill("SIGKILL"), 1_000);
          current.once("exit", () => {
            clearTimeout(kill);
            resolve();
          });
          if (current.connected) current.disconnect();
          else current.kill();
        });
      }
      await retiring;
    },
  };
}

function waitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ settled: true; value: T } | { settled: false }> {
  if (timeoutMs <= 0) return Promise.resolve({ settled: false });
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Codebase search cancelled"));
      return;
    }
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => finish(() => reject(new Error("Codebase search cancelled")));
    const timer = setTimeout(() => finish(() => resolve({ settled: false })), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve({ settled: true, value })),
      (error) => finish(() => reject(error)),
    );
  });
}

/**
 * Composes multiple optional `SessionResourceFactory` instances into one factory so built-in
 * read-only code tools attach cleanly alongside user/project MCP connectors.
 */
export function composeSessionResources(
  ...factories: readonly (SessionResourceFactory | undefined)[]
): SessionResourceFactory | undefined {
  const active = factories.filter((f): f is SessionResourceFactory => f !== undefined);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return async (context, signal) => {
    const acquired: Awaited<ReturnType<SessionResourceFactory>>[] = [];
    try {
      for (const factory of active) {
        acquired.push(await factory(context, signal));
      }
    } catch (error) {
      await Promise.allSettled(acquired.map((resource) => resource.close()));
      throw error;
    }
    return {
      servers: acquired.flatMap((resource) => resource.servers),
      beginTurn(deadline: number) {
        for (const resource of acquired) resource.beginTurn(deadline);
      },
      endTurn() {
        for (const resource of acquired) resource.endTurn();
      },
      async close() {
        const results = await Promise.allSettled(acquired.map((resource) => resource.close()));
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected?.status === "rejected") throw rejected.reason;
      },
    };
  };
}

interface ActiveIndexJob {
  promise: Promise<StoredRepository>;
  abort: AbortController;
  progress: CodebaseIndexProgress;
  snapshot?: CodebaseMainSnapshot;
}

/**
 * Application-owned automatic vector codebase indexing and hybrid search service.
 * Shared across Relay, Custom Assistants, Project Orchestrators, SubAgents, Workflow Engine,
 * and Scheduled Agents.
 */
export class CodebaseIndexService {
  private readonly worker: CodebaseWorkerClient;
  private readonly fetchCooldownMs: number;
  private readonly inlineWaitMs: number;
  private readonly refreshWaitMs: number;
  private readonly tracked = new Set<string>();
  private readonly lastFetchAt = new Map<string, number>();
  private readonly activeJobs = new Map<string, ActiveIndexJob>();
  private readonly shutdownAbort = new AbortController();
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private closed = false;

  constructor(
    stateRoot: string,
    modelRoot: string,
    private readonly git: Git,
    options: CodebaseServiceOptions = {},
  ) {
    this.fetchCooldownMs = options.fetchCooldownMs ?? DEFAULT_FETCH_COOLDOWN_MS;
    this.inlineWaitMs = options.inlineWaitMs ?? DEFAULT_INLINE_WAIT_MS;
    this.refreshWaitMs = options.refreshWaitMs ?? DEFAULT_REFRESH_WAIT_MS;
    this.worker =
      options.worker ??
      createSidecarClient(stateRoot, modelRoot, options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS);
    const interval = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
    if (interval > 0) {
      this.refreshTimer = setInterval(() => {
        if (this.closed) return;
        for (const repoPath of this.tracked) {
          void this.ensureIndexed(repoPath).catch(() => {});
        }
      }, interval);
      this.refreshTimer.unref();
    }
  }

  private requireCodebaseGit(): CodebaseGitOps {
    if (!this.git.codebase) {
      throw new Error("Git codebase indexing operations are unavailable");
    }
    return this.git.codebase;
  }

  private async resolveRepository(cwd: string): Promise<{
    repoKey: string;
    topLevel: string;
    commonDir: string;
  }> {
    const canonical = await realpath(cwd).catch(() => {
      throw new Error("Target repository directory does not exist");
    });
    const info = await this.git.repoInfo(canonical).catch(() => {
      throw new Error("Target directory is not inside a Git repository");
    });
    return {
      repoKey: repoKeyOf(info.commonDir),
      topLevel: info.topLevel,
      commonDir: info.commonDir,
    };
  }

  /** Registers a repository for background automatic indexing of its latest `main` branch. */
  trackRepository(cwd: string): void {
    if (this.closed || !this.git.codebase) return;
    void this.resolveRepository(cwd)
      .then(({ topLevel }) => {
        if (this.closed) return;
        if (this.tracked.size < CODEBASE_LIMITS.maxRepositories) this.tracked.add(topLevel);
        return this.ensureIndexed(topLevel);
      })
      .catch(() => {
        /* Non-Git directories or transient offline states never disrupt callers. */
      });
  }

  /** Triggers or joins single-flight incremental indexing of the repository's latest `main` commit. */
  async ensureIndexed(
    cwd: string,
    options: { forceFetch?: boolean } = {},
  ): Promise<StoredRepository> {
    if (this.closed) throw new Error("Codebase search service is closing");
    const resolved = await this.resolveRepository(cwd);
    if (this.tracked.size < CODEBASE_LIMITS.maxRepositories) this.tracked.add(resolved.topLevel);
    const existingJob = this.activeJobs.get(resolved.repoKey);
    if (existingJob) return existingJob.promise;

    const abort = new AbortController();
    const progress: CodebaseIndexProgress = {
      filesIndexed: 0,
      filesTotal: 0,
      chunksIndexed: 0,
    };
    const signal = AbortSignal.any([this.shutdownAbort.signal, abort.signal]);
    const job: ActiveIndexJob = {
      abort,
      progress,
      promise: Promise.reject(new Error("uninitialized")),
    };
    job.promise.catch(() => {});
    const promise = this.runIndexJob(resolved, job, options.forceFetch === true, signal).finally(
      () => {
        if (this.activeJobs.get(resolved.repoKey) === job) {
          this.activeJobs.delete(resolved.repoKey);
        }
      },
    );
    job.promise = promise;
    this.activeJobs.set(resolved.repoKey, job);
    return promise;
  }

  private async runIndexJob(
    resolved: { repoKey: string; topLevel: string; commonDir: string },
    job: ActiveIndexJob,
    forceFetch: boolean,
    signal: AbortSignal,
  ): Promise<StoredRepository> {
    const codebaseGit = this.requireCodebaseGit();
    const lastFetch = this.lastFetchAt.get(resolved.repoKey) ?? 0;
    const shouldFetch = forceFetch || Date.now() - lastFetch >= this.fetchCooldownMs;

    const snapshot = await codebaseGit.syncMainBranch(resolved.topLevel, {
      fetch: shouldFetch,
      signal,
    });
    job.snapshot = snapshot;
    if (shouldFetch && snapshot.hasOrigin) {
      this.lastFetchAt.set(resolved.repoKey, Date.now());
    }
    const now = new Date().toISOString();
    const effectiveFetchStatus: CodebaseFetchStatus =
      snapshot.fetchStatus === "skipped" ? "cached" : snapshot.fetchStatus;

    const existing = await this.worker.call<StoredRepository | null>(
      "status",
      [resolved.repoKey],
      signal,
    );
    if (
      existing &&
      existing.status === "ready" &&
      existing.commitSha === snapshot.commit &&
      existing.modelId === CODEBASE_MODEL_IDENTITY &&
      existing.chunkerId === CODEBASE_CHUNKER_IDENTITY
    ) {
      const refreshed = await this.worker.call<StoredRepository | null>(
        "markSync",
        [
          {
            repoKey: resolved.repoKey,
            commonDir: snapshot.commonDir,
            topLevel: snapshot.topLevel,
            branch: snapshot.branch,
            ref: snapshot.ref,
            lastSyncAt: now,
            fetchStatus: effectiveFetchStatus,
            fetchWarning: snapshot.fetchWarning ?? null,
          },
        ],
        signal,
      );
      return refreshed ?? existing;
    }

    await this.worker.call(
      "upsertRepository",
      [
        {
          repoKey: resolved.repoKey,
          commonDir: snapshot.commonDir,
          topLevel: snapshot.topLevel,
          branch: snapshot.branch,
          ref: snapshot.ref,
          lastSyncAt: now,
          fetchStatus: effectiveFetchStatus,
          fetchWarning: snapshot.fetchWarning ?? null,
          status: "indexing",
          lastError: null,
        },
      ],
      signal,
    );

    try {
      const entries = await codebaseGit.listTreeFiles(snapshot.topLevel, snapshot.commit, signal);
      const eligible = entries
        .filter((entry) => isIndexableCodeFile(entry.path, entry.size))
        .slice(0, CODEBASE_LIMITS.maxFilesPerRepo);
      const indexedEntries = await this.worker.call<Array<[string, string]>>(
        "indexedFiles",
        [resolved.repoKey],
        signal,
      );
      const indexedMap = new Map(indexedEntries);
      const keepPaths = new Set(eligible.map((entry) => entry.path));
      const deletedPaths = [...indexedMap.keys()].filter((path) => !keepPaths.has(path));
      const toIndex = eligible.filter((entry) => indexedMap.get(entry.path) !== entry.oid);

      job.progress = {
        filesIndexed: eligible.length - toIndex.length,
        filesTotal: eligible.length,
        chunksIndexed: await this.worker.call<number>("chunkCount", [resolved.repoKey], signal),
      };

      let totalChunks = job.progress.chunksIndexed;
      for (let offset = 0; offset < toIndex.length; offset += FILE_BATCH_SIZE) {
        signal.throwIfAborted();
        const slice = toIndex.slice(offset, offset + FILE_BATCH_SIZE);
        const blobs = await codebaseGit.readBlobs(
          snapshot.topLevel,
          slice.map((entry) => entry.oid),
          { maxBytes: CODEBASE_LIMITS.maxFileBytes, signal },
        );
        const files: CodebaseIndexFileInput[] = [];
        for (const entry of slice) {
          const content = blobs.get(entry.oid);
          if (content === undefined) continue;
          files.push({
            path: entry.path,
            oid: entry.oid,
            language: detectCodeLanguage(entry.path),
            content,
          });
        }
        const remaining = CODEBASE_LIMITS.maxChunksPerRepo - totalChunks;
        const batchResult = await this.worker.call<CodebaseIndexBatchResult>(
          "indexBatch",
          [
            {
              repoKey: resolved.repoKey,
              files,
              maxRemainingChunks: remaining,
            } satisfies CodebaseIndexBatchInput,
          ],
          signal,
        );
        totalChunks += batchResult.chunksWritten;
        job.progress = {
          filesIndexed: Math.min(eligible.length, job.progress.filesIndexed + slice.length),
          filesTotal: eligible.length,
          chunksIndexed: totalChunks,
        };
        if (batchResult.truncated) break;
      }

      const finalized = await this.worker.call<StoredRepository>(
        "finalizeCommit",
        [
          {
            repoKey: resolved.repoKey,
            commonDir: snapshot.commonDir,
            topLevel: snapshot.topLevel,
            branch: snapshot.branch,
            ref: snapshot.ref,
            commitSha: snapshot.commit,
            indexedAt: new Date().toISOString(),
            lastSyncAt: now,
            fetchStatus: effectiveFetchStatus,
            fetchWarning: snapshot.fetchWarning ?? null,
            deletedPaths,
          } satisfies CodebaseFinalizeInput,
        ],
        signal,
      );
      return finalized;
    } catch (error) {
      if (!signal.aborted) {
        const message = diagnosticText(
          error instanceof Error ? error.message : "Codebase indexing failed",
        ).slice(0, 240);
        await this.worker
          .call("upsertRepository", [
            {
              repoKey: resolved.repoKey,
              commonDir: snapshot.commonDir,
              topLevel: snapshot.topLevel,
              branch: snapshot.branch,
              ref: snapshot.ref,
              lastSyncAt: now,
              fetchStatus: effectiveFetchStatus,
              fetchWarning: snapshot.fetchWarning ?? null,
              status: existing?.status === "ready" ? "ready" : "error",
              lastError: message,
            },
          ])
          .catch(() => {});
      }
      throw error;
    }
  }

  /** Hybrid ONNX vector + lexical search over the repository's indexed latest `main` branch. */
  async search(
    cwd: string,
    args: BoundCodebaseSearchArgs,
    signal?: AbortSignal,
  ): Promise<CodebaseSearchResult> {
    if (this.closed) throw new Error("Codebase search service is closing");
    const resolved = await this.resolveRepository(cwd);
    const existing = await this.worker.call<StoredRepository | null>(
      "status",
      [resolved.repoKey],
      signal,
    );
    const hasUsableIndex =
      existing !== null &&
      existing.modelId === CODEBASE_MODEL_IDENTITY &&
      existing.chunkerId === CODEBASE_CHUNKER_IDENTITY &&
      existing.commitSha !== null &&
      (existing.status === "ready" || existing.chunkCount > 0);
    const lastFetch = this.lastFetchAt.get(resolved.repoKey) ?? 0;
    const needsSync =
      !hasUsableIndex ||
      this.activeJobs.has(resolved.repoKey) ||
      Date.now() - lastFetch >= this.fetchCooldownMs;

    let fresh = hasUsableIndex && !needsSync;
    let indexingInProgress = false;

    if (needsSync) {
      const indexPromise = this.ensureIndexed(resolved.topLevel);
      // Prevent unhandled rejection when search stops waiting inline and lets indexing finish.
      void indexPromise.catch(() => {});
      const waitBudget = hasUsableIndex ? this.refreshWaitMs : this.inlineWaitMs;
      try {
        const waited = await waitWithTimeout(indexPromise, waitBudget, signal);
        if (waited.settled) {
          fresh = true;
        } else {
          indexingInProgress = true;
        }
      } catch (error) {
        if (signal?.aborted || !hasUsableIndex) throw error;
        fresh = false;
      }
    }

    const current = await this.worker.call<StoredRepository | null>(
      "status",
      [resolved.repoKey],
      signal,
    );
    const active = this.activeJobs.get(resolved.repoKey);

    if (!current || (current.chunkCount === 0 && current.status !== "ready")) {
      return {
        status: "indexing",
        repository: resolved.topLevel,
        branch: active?.snapshot?.branch ?? current?.branch ?? "main",
        ref: active?.snapshot?.ref ?? current?.ref ?? "refs/heads/main",
        commit: active?.snapshot?.commit ?? current?.commitSha ?? "",
        indexedAt: current?.indexedAt ?? null,
        fresh: false,
        fetchStatus: current?.fetchStatus ?? "skipped",
        ...(current?.fetchWarning ? { fetchWarning: current.fetchWarning } : {}),
        model: CODEBASE_MODEL_LABEL,
        totalFiles: current?.fileCount ?? 0,
        totalChunks: current?.chunkCount ?? 0,
        truncated: false,
        ...(active ? { progress: { ...active.progress } } : {}),
        message:
          "Initial indexing of the latest main branch is in progress. Retry code60_search_codebase shortly.",
        hits: [],
      };
    }

    const output = await this.worker.call<CodebaseWorkerSearchOutput>(
      "search",
      [
        {
          repoKey: resolved.repoKey,
          query: args.query,
          limit: args.limit,
          ...(args.pathPrefix ? { pathPrefix: args.pathPrefix } : {}),
          ...(args.language ? { language: args.language } : {}),
        } satisfies CodebaseWorkerSearchInput,
      ],
      signal,
    );

    return {
      status: indexingInProgress ? "indexing" : "ready",
      repository: output.repository.topLevel,
      branch: output.repository.branch,
      ref: output.repository.ref,
      commit: output.repository.commitSha ?? "",
      indexedAt: output.repository.indexedAt,
      fresh,
      fetchStatus: output.repository.fetchStatus,
      ...(output.repository.fetchWarning ? { fetchWarning: output.repository.fetchWarning } : {}),
      model: CODEBASE_MODEL_LABEL,
      totalFiles: output.repository.fileCount,
      totalChunks: output.repository.chunkCount,
      truncated: output.repository.chunkCount >= CODEBASE_LIMITS.maxChunksPerRepo,
      ...(indexingInProgress && active ? { progress: { ...active.progress } } : {}),
      hits: output.hits,
    };
  }

  /** Returns the current codebase index status without triggering a remote fetch. */
  async status(cwd: string, signal?: AbortSignal): Promise<CodebaseIndexStatus> {
    if (this.closed) throw new Error("Codebase search service is closing");
    const resolved = await this.resolveRepository(cwd);
    const active = this.activeJobs.get(resolved.repoKey);
    const stored = await this.worker.call<StoredRepository | null>(
      "status",
      [resolved.repoKey],
      signal,
    );
    if (!stored) {
      return {
        status: active ? "indexing" : "unindexed",
        repository: resolved.topLevel,
        branch: active?.snapshot?.branch ?? null,
        ref: active?.snapshot?.ref ?? null,
        commit: active?.snapshot?.commit ?? null,
        indexedAt: null,
        lastSyncAt: null,
        fetchStatus: null,
        fileCount: 0,
        chunkCount: 0,
        model: CODEBASE_MODEL_LABEL,
        ...(active ? { progress: { ...active.progress } } : {}),
      };
    }
    return {
      status: active ? "indexing" : stored.status,
      repository: stored.topLevel,
      branch: stored.branch,
      ref: stored.ref,
      commit: stored.commitSha,
      indexedAt: stored.indexedAt,
      lastSyncAt: stored.lastSyncAt,
      fetchStatus: stored.fetchStatus,
      ...(stored.fetchWarning ? { fetchWarning: stored.fetchWarning } : {}),
      fileCount: stored.fileCount,
      chunkCount: stored.chunkCount,
      model: CODEBASE_MODEL_LABEL,
      ...(active ? { progress: { ...active.progress } } : {}),
      ...(stored.lastError ? { error: stored.lastError } : {}),
    };
  }

  /** Handles a built-in codebase MCP tool call for either Relay (explicit cwd) or bound sessions. */
  async callTool(
    role: "relay" | "bound",
    name: string,
    args: unknown,
    boundRepository?: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (name === "code60_search_codebase") {
      if (role === "relay") {
        const parsed = parseCodebaseSearchArgs("relay", args);
        const { cwd, ...searchArgs } = parsed;
        return this.search(cwd, searchArgs, signal);
      }
      if (!boundRepository) throw new Error("No repository is bound for codebase search");
      return this.search(boundRepository, parseCodebaseSearchArgs("bound", args), signal);
    }
    if (name === "code60_codebase_index_status") {
      if (role === "relay") {
        const parsed = parseCodebaseStatusArgs("relay", args);
        return this.status(parsed.cwd, signal);
      }
      if (!boundRepository) throw new Error("No repository is bound for codebase search");
      parseCodebaseStatusArgs("bound", args);
      return this.status(boundRepository, signal);
    }
    throw new Error("Unknown codebase search tool");
  }

  /**
   * Creates a `SessionResourceFactory` exposing the read-only `code60-code` MCP server bound
   * strictly to `repositoryPath` via the gateway's existing capability broker.
   */
  sessionResources(
    repositoryPath: string,
    expose: McpRuntimePorts["expose"] | undefined,
  ): SessionResourceFactory | undefined {
    if (!expose) return undefined;
    const tools = codebaseSearchToolsForRole("bound").map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    }));
    return async () => {
      this.trackRepository(repositoryPath);
      const owner = randomUUID();
      const exposed = await expose({
        id: CODEBASE_SEARCH_SERVER_NAME,
        owner,
        tools,
        call: async (name, args, signal) => {
          try {
            const result = await this.callTool("bound", name, args, repositoryPath, signal);
            return {
              content: [{ type: "text", text: JSON.stringify(result) }],
              isError: false,
            };
          } catch (error) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error:
                      error instanceof Error
                        ? diagnosticText(error.message)
                        : "Codebase search request failed",
                  }),
                },
              ],
              isError: true,
            };
          }
        },
      });
      return {
        servers: [exposed.descriptor],
        beginTurn() {},
        endTurn() {},
        close: () => exposed.revoke(),
      };
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.refreshTimer);
    this.refreshTimer = undefined;
    this.shutdownAbort.abort();
    for (const job of this.activeJobs.values()) job.abort.abort();
    await Promise.allSettled([...this.activeJobs.values()].map((job) => job.promise));
    this.activeJobs.clear();
    this.tracked.clear();
    await this.worker.close();
  }
}
