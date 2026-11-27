import { join } from "node:path";
import type { CodebaseFetchStatus, CodebaseSearchHit } from "../bridge/index.js";
import {
  buildFtsQuery,
  CODEBASE_LIMITS,
  checkedVector,
  chunkCodeFile,
  type RagEmbedder,
  rankCodebaseHits,
} from "../core/index.js";
import { lockPrivateState } from "../platform/index.js";
import {
  CODEBASE_VECTOR_DIMENSIONS,
  CodebaseStore,
  type StoredChunkInput,
  type StoredRepository,
} from "./codebase-store.js";
import { loadRagModel } from "./rag-model.js";

export interface CodebaseIndexFileInput {
  path: string;
  oid: string;
  language: string;
  content: string;
}

export interface CodebaseIndexBatchInput {
  repoKey: string;
  files: readonly CodebaseIndexFileInput[];
  maxRemainingChunks: number;
}

export interface CodebaseIndexBatchResult {
  filesProcessed: number;
  chunksWritten: number;
  truncated: boolean;
}

export interface CodebaseFinalizeInput {
  repoKey: string;
  commonDir: string;
  topLevel: string;
  branch: string;
  ref: string;
  commitSha: string;
  indexedAt: string;
  lastSyncAt: string;
  durationMs?: number | null;
  fetchStatus: CodebaseFetchStatus;
  fetchWarning?: string | null;
  deletedPaths: readonly string[];
}

export interface CodebaseWorkerSearchInput {
  repoKey: string;
  query: string;
  limit: number;
  pathPrefix?: string | undefined;
  language?: string | undefined;
}

export interface CodebaseWorkerSearchOutput {
  hits: CodebaseSearchHit[];
  repository: StoredRepository;
}

/** Pure worker batch indexer, directly unit-testable with a fake embedder. */
export async function indexCodebaseBatch(
  store: CodebaseStore,
  input: CodebaseIndexBatchInput,
  load: () => Promise<RagEmbedder>,
): Promise<CodebaseIndexBatchResult> {
  if (input.files.length === 0) {
    return { filesProcessed: 0, chunksWritten: 0, truncated: false };
  }
  const embedder = await load();
  let remaining = Math.max(0, input.maxRemainingChunks);
  let chunksWritten = 0;
  let truncated = false;
  const prepared: Array<{
    path: string;
    blobOid: string;
    language: string;
    chunks: StoredChunkInput[];
  }> = [];

  for (const file of input.files) {
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const rawChunks = chunkCodeFile(file.path, file.content, (text) => embedder.countTokens(text));
    if (rawChunks.length === 0) {
      prepared.push({ path: file.path, blobOid: file.oid, language: file.language, chunks: [] });
      continue;
    }
    const slice = rawChunks.length > remaining ? rawChunks.slice(0, remaining) : rawChunks;
    if (slice.length < rawChunks.length) truncated = true;
    const vectors: Float32Array[] = [];
    for (let offset = 0; offset < slice.length; offset += CODEBASE_LIMITS.embedBatchSize) {
      const group = slice.slice(offset, offset + CODEBASE_LIMITS.embedBatchSize);
      const embedded = await embedder.embedDocuments(group.map((chunk) => chunk.embeddingText));
      if (embedded.length !== group.length) {
        throw new Error("The embedding model returned an incomplete batch");
      }
      for (const vector of embedded) {
        vectors.push(checkedVector(vector, CODEBASE_VECTOR_DIMENSIONS));
      }
    }
    prepared.push({
      path: file.path,
      blobOid: file.oid,
      language: file.language,
      chunks: slice.map((chunk, i) => ({
        chunkIndex: chunk.index,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        text: chunk.text,
        vector: vectors[i] as Float32Array,
      })),
    });
    remaining -= slice.length;
    chunksWritten += slice.length;
  }

  store.replaceFiles(input.repoKey, prepared);
  return { filesProcessed: prepared.length, chunksWritten, truncated };
}

/** Hybrid ONNX vector + SQLite FTS5 RRF search over an indexed repository. */
export async function searchCodebaseStore(
  store: CodebaseStore,
  input: CodebaseWorkerSearchInput,
  load: () => Promise<RagEmbedder>,
): Promise<CodebaseWorkerSearchOutput> {
  const repository = store.getRepository(input.repoKey);
  if (!repository || !store.isCompatible(repository)) {
    throw new Error("Repository has not been indexed yet");
  }
  const embedder = await load();
  if (embedder.countTokens(input.query) > CODEBASE_LIMITS.maxQueryTokens) {
    throw new Error("Query exceeds the 512-token model input limit. Shorten the query.");
  }
  const queryVector = checkedVector(
    await embedder.embedQuery(input.query),
    CODEBASE_VECTOR_DIMENSIONS,
  );
  const filters = {
    ...(input.pathPrefix ? { pathPrefix: input.pathPrefix } : {}),
    ...(input.language ? { language: input.language } : {}),
  };
  const vectorCandidates = store.vectorSearch(input.repoKey, queryVector, filters, 100);
  const ftsQuery = buildFtsQuery(input.query);
  const lexicalCandidates = ftsQuery
    ? store.lexicalSearch(input.repoKey, ftsQuery, filters, 100)
    : [];
  const ranked = rankCodebaseHits(vectorCandidates, lexicalCandidates, input.limit);
  return {
    repository,
    hits: ranked.map((hit) => ({
      path: hit.path,
      startLine: hit.startLine,
      endLine: hit.endLine,
      language: hit.language,
      score: hit.score,
      vectorScore: hit.vectorScore,
      lexicalMatch: hit.lexicalMatch,
      content: hit.text,
    })),
  };
}

let store: CodebaseStore | undefined;
let closeStore: (() => Promise<void>) | undefined;
let modelRoot = "";
let modelPromise: Promise<RagEmbedder> | undefined;

const loadModel = () => {
  modelPromise ??= loadRagModel(modelRoot).catch((error) => {
    modelPromise = undefined;
    throw error;
  });
  return modelPromise;
};

async function openCodebaseStore(root: string) {
  const unlock = await lockPrivateState(root);
  try {
    const database = new CodebaseStore(join(root, "index.sqlite"));
    return {
      store: database,
      async close() {
        try {
          database.close();
        } finally {
          await unlock();
        }
      },
    };
  } catch (error) {
    await unlock();
    throw error;
  }
}

async function dispatch(op: string, args: unknown[]): Promise<unknown> {
  if (op === "init") {
    const opened = await openCodebaseStore(String(args[0]));
    store = opened.store;
    closeStore = opened.close;
    modelRoot = String(args[1]);
    return { ready: true };
  }
  if (!store) throw new Error("Codebase index storage is unavailable");
  switch (op) {
    case "status":
      return store.getRepository(String(args[0]));
    case "listRepositories":
      return store.listRepositories();
    case "deleteRepository":
      return store.deleteRepository(String(args[0]));
    case "indexedFiles":
      return [...store.indexedFiles(String(args[0])).entries()];
    case "upsertRepository":
      store.upsertRepository(args[0] as Parameters<CodebaseStore["upsertRepository"]>[0]);
      return null;
    case "markSync":
      return store.markSync(args[0] as Parameters<CodebaseStore["markSync"]>[0]);
    case "chunkCount":
      return store.chunkCount(String(args[0]));
    case "indexBatch":
      return indexCodebaseBatch(store, args[0] as CodebaseIndexBatchInput, loadModel);
    case "finalizeCommit":
      return store.finalizeCommit(args[0] as CodebaseFinalizeInput);
    case "search":
      return searchCodebaseStore(store, args[0] as CodebaseWorkerSearchInput, loadModel);
    default:
      throw new Error("Unknown codebase index operation");
  }
}

if (process.send) {
  let queue: Promise<void> = Promise.resolve();
  process.on("message", (message: { id: string; op: string; args: unknown[] }) => {
    queue = queue
      .then(async () => {
        try {
          const result = await dispatch(message.op, message.args);
          process.send?.({ id: message.id, result });
        } catch (error) {
          const text =
            error instanceof Error &&
            /^(Query exceeds|Repository has not been indexed|Codebase index|The embedding model)/.test(
              error.message,
            )
              ? error.message
              : "Codebase vector search failed. Verify bundled model assets and storage.";
          process.send?.({ id: message.id, error: text });
        }
      })
      .catch(() => {});
  });
  process.once("disconnect", () => {
    void (closeStore?.() ?? Promise.resolve()).then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
