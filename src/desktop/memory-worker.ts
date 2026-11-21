import type {
  MemoryAction,
  MemoryBrowse,
  MemoryGeneration,
  MemoryRecord,
  MemorySettings,
  MemorySource,
} from "../bridge/index.js";
import { isMemoryTool, memoryToolSchemas, parseValue } from "../bridge/index.js";
import { checkedVector, chunkText, type RagEmbedder, topMatches } from "../core/index.js";
import { lockPrivateState } from "../platform/index.js";
import { MemoryStore } from "./memory-store.js";
import { loadRagModel } from "./rag-model.js";

export const MEMORY_MODEL =
  "jina-v2-base-code:516f4baf13dec4ddddda8631e019b5737c8bc250:q8:mean:normalized:768:512:64:chunks-v2";
let store: MemoryStore | undefined;
let closeStore: (() => Promise<void>) | undefined;
/** Only the owning sidecar may open/migrate/prune the application store. */
export async function openMemoryStore(path: string) {
  const unlock = await lockPrivateState(path);
  try {
    const database = new MemoryStore(path);
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
let model: Promise<RagEmbedder> | undefined;
let root = "";
const embedder = () => {
  model ??= loadRagModel(root).catch((error) => {
    model = undefined;
    throw error;
  });
  return model;
};
export async function indexMemoryBatch(db: MemoryStore, load: () => Promise<RagEmbedder>) {
  const records = db.unindexed(MEMORY_MODEL);
  if (!records.length) return false;
  const embed = await load();
  for (const record of records) {
    const spans = chunkText(record.text, embed.countTokens);
    const vectors = [];
    for (let start = 0; start < spans.length; start += 4) {
      const batch = await embed.embedDocuments(
        spans.slice(start, start + 4).map((s) => record.text.slice(s.start, s.end)),
      );
      for (const vector of batch) checkedVector(vector, 768);
      vectors.push(...batch);
    }
    db.setVectors(record.id, MEMORY_MODEL, vectors);
  }
  return true;
}
let pending = Promise.resolve();
let indexing = false;
let indexAttempts = 0;
const INDEX_RETRY_DELAYS = [1000, 5000, 15000];
const indexFailed = () => indexAttempts > INDEX_RETRY_DELAYS.length;
let retry: ReturnType<typeof setTimeout> | undefined;
let expiring = false;
let retentionFailed = false;
function scheduleExpiry() {
  if (!process.send || expiring || !store) return;
  expiring = true;
  setImmediate(() => {
    pending = pending
      .then(() => {
        let count = 0;
        try {
          count = store?.expireBatch() ?? 0;
          retentionFailed = false;
          if (count) process.send?.({ changed: true });
        } finally {
          expiring = false;
        }
        if (count === 64) scheduleExpiry();
      })
      .catch(() => {
        expiring = false;
        retentionFailed = true;
        process.send?.({ changed: true });
      });
  });
}
function scheduleIndex() {
  if (!process.send || indexing || retry || indexFailed() || !store?.settings().enabled) return;
  indexing = true;
  setImmediate(() => {
    pending = pending
      .then(async () => {
        let more = false;
        try {
          if (store) more = await indexMemoryBatch(store, embedder);
          indexAttempts = 0;
        } catch {
          const delay = INDEX_RETRY_DELAYS[indexAttempts++];
          if (delay !== undefined) {
            retry = setTimeout(() => {
              retry = undefined;
              scheduleIndex();
            }, delay);
            retry.unref();
          }
        }
        process.send?.({ changed: true });
        indexing = false;
        if (more) scheduleIndex();
      })
      .catch(() => {
        indexing = false;
      });
  });
}

export async function memorySearch(
  db: MemoryStore,
  cid: string,
  query: string,
  load: () => Promise<RagEmbedder>,
  projects: readonly string[] = [],
  includeDisputed = false,
) {
  if (!db.eligible(cid, "", 1, projects, includeDisputed).length) return { records: [] };
  const lexical = db.lexical(cid, query, projects, includeDisputed);
  const lexicalRank = new Map(lexical.map((id, index) => [id, index]));
  const lexicalHits: MemoryRecord[] = [];
  // Bounded semantic shortlist, sorted by descending similarity then ID.
  const semantic: { record: MemoryRecord; similarity: number }[] = [];
  let warning: string | undefined;
  let embed: RagEmbedder | undefined;
  let queries: Float32Array[] = [];
  try {
    const loaded = await load();
    embed = loaded;
    const spans = chunkText(query, loaded.countTokens);
    if (spans.length > 8) throw new Error("Memory query exceeds eight embedding chunks");
    queries = await Promise.all(spans.map((s) => loaded.embedQuery(query.slice(s.start, s.end))));
  } catch {
    warning = "Semantic memory search unavailable; using lexical results only.";
  }
  let cursor = "";
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > 15000)
      throw new Error("Memory retrieval timed out; results are incomplete");
    const page = db.eligible(cid, cursor, 256, projects, includeDisputed);
    if (!page.length) break;
    for (const record of page) {
      cursor = record.id;
      let similarity = -1;
      if (embed && queries.length && record.state === "active") {
        const vectors = db.vectors(record.id, MEMORY_MODEL);
        if (!vectors.length) {
          warning =
            "Memory search index is incomplete; lexical recall remains available while indexing catches up.";
        }
        for (const q of queries) {
          for (const vector of vectors) {
            checkedVector(vector, 768);
            const best = topMatches(q, vector, 768, 1)[0];
            if (best) similarity = Math.max(similarity, best.score);
          }
        }
      }
      if (lexicalRank.has(record.id)) lexicalHits.push(record);
      if (similarity < 0.25) continue;
      const worst = semantic.at(-1);
      if (semantic.length >= 100 && worst && worst.similarity >= similarity) continue;
      let at = semantic.findIndex(
        (s) =>
          s.similarity < similarity || (s.similarity === similarity && s.record.id > record.id),
      );
      if (at < 0) at = semantic.length;
      semantic.splice(at, 0, { record, similarity });
      if (semantic.length > 100) semantic.pop();
    }
  }
  // Reciprocal-rank fusion: one weak keyword hit must not outrank a strong semantic match.
  const semanticRank = new Map(semantic.map((s, index) => [s.record.id, index]));
  const candidates = new Map<string, MemoryRecord>();
  for (const record of [...lexicalHits, ...semantic.map((s) => s.record)])
    candidates.set(record.id, record);
  const ranked = [...candidates.values()].map((record) => {
    const l = lexicalRank.get(record.id);
    const v = semanticRank.get(record.id);
    const ageDays = Math.max(0, (Date.now() - Date.parse(record.eventAt)) / 86400000);
    const recency =
      record.type === "episodic" || record.type === "history" ? 1 / (1 + ageDays / 30) : 1;
    return {
      record,
      score:
        (l === undefined ? 0 : 1 / (60 + l)) +
        (v === undefined ? 0 : 1 / (60 + v)) +
        recency / 1000 +
        (record.pinned ? 0.01 : 0),
    };
  });
  ranked.sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
  ranked.length = Math.min(ranked.length, 32);
  return { records: ranked.map((r) => r.record), ...(warning ? { warning } : {}) };
}
async function dispatch(op: string, args: unknown[]) {
  if (op === "init") {
    const opened = await openMemoryStore(String(args[0]));
    store = opened.store;
    closeStore = opened.close;
    root = String(args[1]);
    scheduleExpiry();
    scheduleIndex();
    return { ...store.snapshot(), indexFailed: indexFailed(), retentionFailed };
  }
  if (!store) throw new Error("Memory storage is unavailable");
  switch (op) {
    case "snapshot":
      return { ...store.snapshot(), indexFailed: indexFailed(), retentionFailed };
    case "retention-preview":
      return store.previewRetention(Number(args[0]));
    case "configure": {
      store.configure(args[0] as MemorySettings, args[1] as string | undefined);
      if (!store.settings().enabled) {
        clearTimeout(retry);
        retry = undefined;
      }
      scheduleIndex();
      scheduleExpiry();
      return;
    }
    case "maintain":
      scheduleExpiry();
      return;
    case "register": {
      const registered = store.register(
        String(args[0]),
        String(args[1]),
        args[2] == null ? null : String(args[2]),
      );
      process.send?.({ changed: true });
      return registered;
    }
    case "append": {
      const appended = store.append(
        String(args[0]),
        String(args[1]),
        args[2] as MemorySource[],
        Boolean(args[3]),
      );
      if (args[3]) process.send?.({ changed: true });
      return appended;
    }
    case "range":
      return store.range(String(args[0]));
    case "rewind":
      return store.rewind(String(args[0]), Number(args[1]));
    case "publish": {
      const result = store.publish(
        String(args[0]),
        Number(args[1]),
        Number(args[2]),
        args[3] as MemoryGeneration,
        String(args[4]),
        args[5] as string | undefined,
      );
      scheduleIndex();
      return result;
    }
    case "agent-tool": {
      const cid = String(args[0]);
      const name = String(args[1]);
      if (!isMemoryTool(name)) throw new Error("Unknown memory tool");
      const request = parseValue(memoryToolSchemas[name], args[2]);
      if (!store.settings().enabled) return { status: "disabled" };
      if (name !== "code60_retrieve_memories") {
        const result = store.agentWrite(cid, name, request);
        if (result.status === "ok") {
          scheduleIndex();
          process.send?.({ changed: true });
        }
        return result;
      }
      const query = parseValue(memoryToolSchemas.code60_retrieve_memories, request);
      // Explicit tools never expand scope from a caller-supplied project or target.
      const hits = query.query.trim()
        ? await memorySearch(store, cid, query.query, embedder, [], true)
        : { records: store.eligible(cid, "", query.limit, [], true) };
      const records = hits.records.slice(0, query.limit);
      return {
        ...hits,
        status: records.length ? "ok" : "no-matches",
        records,
        sources: store.tail(cid),
      };
    }
    case "browse":
      return store.browse(args[0] as MemoryBrowse);
    case "detail":
      return store.detail(String(args[0]));
    case "action": {
      const result = store.action(args[0] as MemoryAction);
      scheduleIndex();
      return result;
    }
    case "search": {
      const database = store;
      const targets = (args[2] ?? []) as { cwd: string; device: bigint; inode: bigint }[];
      if (targets.length > 256) throw new Error("Memory target limit exceeded");
      const projects = targets.map((target) => database.project(target.cwd, target));
      return memorySearch(store, String(args[0]), String(args[1]), embedder, projects);
    }
    case "tail":
      return store.tail(String(args[0]));
    case "checkpoint":
      return store.checkpoint(String(args[0]));
    case "reindex":
      clearTimeout(retry);
      retry = undefined;
      indexAttempts = 0;
      store.reindex();
      scheduleIndex();
      return;
    case "used":
      return store.markUsed(args[0] as string[]);
    default:
      throw new Error("Unknown memory operation");
  }
}
if (process.send) {
  process.on("message", (message: { id: string; op: string; args: unknown[] }) => {
    pending = pending
      .then(async () => {
        try {
          process.send?.({ id: message.id, result: await dispatch(message.op, message.args) });
        } catch {
          process.send?.({
            id: message.id,
            error:
              "Memory storage or search failed. Check available disk space and memory settings.",
          });
        }
      })
      .catch(() => {});
  });
  process.once("disconnect", () => {
    clearTimeout(retry);
    void (closeStore?.() ?? Promise.resolve()).then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
