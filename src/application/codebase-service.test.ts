import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { defaultDeps, type RagEmbedder } from "../core/index.js";
import { CodebaseIndexService, type CodebaseWorkerClient } from "./codebase-service.js";
import { CODEBASE_VECTOR_DIMENSIONS, CodebaseStore } from "./codebase-store.js";
import {
  type CodebaseFinalizeInput,
  type CodebaseIndexBatchInput,
  type CodebaseWorkerSearchInput,
  indexCodebaseBatch,
  searchCodebaseStore,
} from "./codebase-worker.js";

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

function createFakeEmbedder(): { embedder: RagEmbedder; embedCalls: () => number } {
  let calls = 0;
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
    embedCalls: () => calls,
    embedder: {
      countTokens: (text) => 2 + (text.trim() ? text.trim().split(/\s+/).length : 0),
      embedDocuments: async (texts) => {
        calls += texts.length;
        return texts.map(vectorFor);
      },
      embedQuery: async (text) => vectorFor(text),
    },
  };
}

function createInProcessWorker(dbPath: string, embedder: RagEmbedder): CodebaseWorkerClient {
  const store = new CodebaseStore(dbPath);
  return {
    async call<T>(op: string, args: unknown[]): Promise<T> {
      switch (op) {
        case "status":
          return store.getRepository(String(args[0])) as T;
        case "listRepositories":
          return store.listRepositories() as T;
        case "deleteRepository":
          return store.deleteRepository(String(args[0])) as T;
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

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("CodebaseIndexService", () => {
  it("automatically indexes latest origin/main, shares index across worktrees, and incrementally embeds only changed files", async () => {
    const bare = await makeTempDir("code60-svc-bare-");
    const seed = await makeTempDir("code60-svc-seed-");
    const clone = await makeTempDir("code60-svc-clone-");
    const worktree = join(await makeTempDir("code60-svc-wt-"), "wt1");
    const state = await makeTempDir("code60-svc-state-");

    await git(["init", "--bare", "-b", "main"], bare);
    await git(["init", "-b", "main"], seed);
    await git(["remote", "add", "origin", bare], seed);
    await writeFile(
      join(seed, "alpha.ts"),
      "export function alphaScheduler() { return 'schedule_alpha'; }\n",
    );
    await writeFile(
      join(seed, "beta.ts"),
      "export function betaRouter() { return 'route_beta'; }\n",
    );
    await git(["add", "alpha.ts", "beta.ts"], seed);
    await git(["commit", "-m", "v1"], seed);
    await git(["push", "-u", "origin", "main"], seed);
    await git(["clone", bare, clone], tmpdir());
    await git(["worktree", "add", "-b", "code60/test-wt", worktree, "HEAD"], clone);

    const { embedder, embedCalls } = createFakeEmbedder();
    const service = new CodebaseIndexService(state, state, defaultDeps().git, {
      fetchCooldownMs: 0,
      refreshIntervalMs: 0,
      worker: createInProcessWorker(join(state, "index.sqlite"), embedder),
    });

    try {
      const first = await service.search(clone, { query: "alphaScheduler", limit: 5 });
      expect(first.status).toBe("ready");
      expect(first.branch).toBe("main");
      expect(first.ref).toBe("refs/remotes/origin/main");
      expect(first.fetchStatus).toBe("fetched");
      expect(first.hits[0]?.path).toBe("alpha.ts");
      expect(embedCalls()).toBe(2);

      // Searching from a linked worktree shares the exact same index without re-embedding!
      const fromWorktree = await service.search(worktree, { query: "betaRouter", limit: 5 });
      expect(fromWorktree.status).toBe("ready");
      expect(fromWorktree.hits[0]?.path).toBe("beta.ts");
      expect(embedCalls()).toBe(2);

      // Push a new commit modifying only gamma.ts to origin/main; only gamma.ts should be embedded.
      await writeFile(
        join(seed, "gamma.ts"),
        "export function gammaVectorEngine() { return 'onnx_gamma'; }\n",
      );
      await git(["add", "gamma.ts"], seed);
      await git(["commit", "-m", "v2"], seed);
      await git(["push", "origin", "main"], seed);

      const second = await service.search(worktree, { query: "gammaVectorEngine", limit: 5 });
      expect(second.status).toBe("ready");
      expect(second.totalFiles).toBe(3);
      expect(second.hits[0]?.path).toBe("gamma.ts");
      // Only 1 new file chunk was embedded!
      expect(embedCalls()).toBe(3);

      const status = await service.status(clone);
      expect(status.status).toBe("ready");
      expect(status.fileCount).toBe(3);
      expect(status.chunkCount).toBe(3);

      let notifications = 0;
      const unsubscribe = service.subscribe(() => {
        notifications++;
      });
      try {
        const overview = await service.overview();
        expect(overview.repositories).toHaveLength(1);
        const repoEntry = overview.repositories[0];
        if (!repoEntry) throw new Error("Expected indexed repository in overview");
        expect(repoEntry.fileCount).toBe(3);
        expect(repoEntry.chunkCount).toBe(3);
        expect(repoEntry.sizeBytes).toBeGreaterThan(0);
        expect(repoEntry.lastDurationMs).toBeGreaterThanOrEqual(0);
        expect(repoEntry.languages).toEqual([{ language: "typescript", files: 3, chunks: 3 }]);

        const byKey = await service.searchByKey(repoEntry.repoKey, {
          query: "alphaScheduler",
          limit: 5,
        });
        expect(byKey.status).toBe("ready");
        expect(byKey.hits[0]?.path).toBe("alpha.ts");

        expect(await service.removeByKey(repoEntry.repoKey)).toBe(true);
        expect(notifications).toBeGreaterThan(0);
        expect((await service.overview()).repositories).toHaveLength(0);
      } finally {
        unsubscribe();
      }
    } finally {
      await service.close();
    }
  });
});
