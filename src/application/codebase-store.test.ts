import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RagEmbedder } from "../core/index.js";
import { CODEBASE_VECTOR_DIMENSIONS, CodebaseStore } from "./codebase-store.js";
import { indexCodebaseBatch, searchCodebaseStore } from "./codebase-worker.js";

const dirs: string[] = [];

function fakeEmbedder(): RagEmbedder {
  const vectorFor = (text: string): Float32Array => {
    const v = new Float32Array(CODEBASE_VECTOR_DIMENSIONS);
    const words = text.toLowerCase().match(/[a-z0-9_]+/g) ?? ["empty"];
    for (const word of words) {
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

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("CodebaseStore and codebase-worker", () => {
  it("indexes files, supports hybrid vector+FTS5 search with filters, and updates incrementally", async () => {
    const root = await mkdtemp(join(tmpdir(), "code60-codebase-store-"));
    dirs.push(root);
    const store = new CodebaseStore(join(root, "index.sqlite"));
    const embedder = fakeEmbedder();
    const repoKey = "a".repeat(64);
    const now = new Date().toISOString();

    try {
      store.upsertRepository({
        repoKey,
        commonDir: "/repo/.git",
        topLevel: "/repo",
        branch: "main",
        ref: "refs/heads/main",
        lastSyncAt: now,
        fetchStatus: "no_remote",
        status: "indexing",
      });

      const batch = await indexCodebaseBatch(
        store,
        {
          repoKey,
          maxRemainingChunks: 100,
          files: [
            {
              path: "src/auth/token.ts",
              oid: "1".repeat(40),
              language: "typescript",
              content:
                "export function verifyJwtSessionToken(token: string) {\n  return token.startsWith('jwt_');\n}\n",
            },
            {
              path: "src/billing/invoice.py",
              oid: "2".repeat(40),
              language: "python",
              content: "def calculate_invoice_total(items):\n    return sum(items)\n",
            },
          ],
        },
        async () => embedder,
      );
      expect(batch.filesProcessed).toBe(2);
      expect(batch.chunksWritten).toBe(2);

      const finalized = store.finalizeCommit({
        repoKey,
        commonDir: "/repo/.git",
        topLevel: "/repo",
        branch: "main",
        ref: "refs/heads/main",
        commitSha: "c".repeat(40),
        indexedAt: now,
        lastSyncAt: now,
        fetchStatus: "no_remote",
        deletedPaths: [],
      });
      expect(finalized.status).toBe("ready");
      expect(finalized.fileCount).toBe(2);
      expect(finalized.chunkCount).toBe(2);

      const authResults = await searchCodebaseStore(
        store,
        { repoKey, query: "verifyJwtSessionToken", limit: 5 },
        async () => embedder,
      );
      expect(authResults.hits[0]?.path).toBe("src/auth/token.ts");
      expect(authResults.hits[0]?.lexicalMatch).toBe(true);
      expect(authResults.hits[0]?.startLine).toBe(1);

      const filtered = await searchCodebaseStore(
        store,
        {
          repoKey,
          query: "invoice total",
          limit: 5,
          pathPrefix: "src/billing",
          language: "python",
        },
        async () => embedder,
      );
      expect(filtered.hits).toHaveLength(1);
      expect(filtered.hits[0]?.path).toBe("src/billing/invoice.py");

      // Delete a file on a subsequent commit and verify FTS + chunks stay clean.
      const updated = store.finalizeCommit({
        repoKey,
        commonDir: "/repo/.git",
        topLevel: "/repo",
        branch: "main",
        ref: "refs/heads/main",
        commitSha: "d".repeat(40),
        indexedAt: now,
        lastSyncAt: now,
        fetchStatus: "fetched",
        deletedPaths: ["src/billing/invoice.py"],
      });
      expect(updated.fileCount).toBe(1);
      expect(updated.chunkCount).toBe(1);
      expect([...store.indexedFiles(repoKey).keys()]).toEqual(["src/auth/token.ts"]);
    } finally {
      store.close();
    }
  });
});
