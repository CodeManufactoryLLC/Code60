import type {
  MemoryAction,
  MemoryBrowse,
  MemoryGeneration,
  MemoryRecord,
  MemorySource,
} from "../bridge/index.js";
import { checkedVector, chunkText, type RagEmbedder, topMatches } from "../core/index.js";
import { MemoryStore } from "./memory-store.js";
import { loadRagModel } from "./rag-model.js";

export const MEMORY_MODEL =
  "jina-v2-base-code:516f4baf13dec4ddddda8631e019b5737c8bc250:q8:mean:normalized:768:512:64:chunks-v2";
let store: MemoryStore | undefined;
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
function scheduleIndex() {
  if (!process.send || indexing || !store) return;
  indexing = true;
  setImmediate(() => {
    pending = pending
      .then(async () => {
        let more = false;
        try {
          if (store) more = await indexMemoryBatch(store, embedder);
        } catch {
          /* Missing/offline model leaves lexical recall available; explicit rebuild retries. */
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
) {
  const settings = db.settings();
  if (!db.eligible(cid, "", 1, projects).length) return { records: [] };
  const lexical = db.lexical(cid, query, projects);
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
    const page = db.eligible(cid, cursor, 256, projects);
    if (!page.length) break;
    for (const record of page) {
      cursor = record.id;
      if (!settings.types[record.type]) continue;
      const days = settings.retentionDays[record.type];
      if (days && !record.pinned && Date.now() - Date.parse(record.createdAt) > days * 86400000)
        continue;
      let similarity = -1;
      if (embed && queries.length) {
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
    store = new MemoryStore(String(args[0]));
    root = String(args[1]);
    scheduleIndex();
    return store.snapshot();
  }
  if (!store) throw new Error("Memory storage is unavailable");
  switch (op) {
    case "snapshot":
      return store.snapshot();
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
    case "publish": {
      const result = store.publish(
        String(args[0]),
        Number(args[1]),
        Number(args[2]),
        args[3] as MemoryGeneration,
        String(args[4]),
      );
      scheduleIndex();
      return result;
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
    case "reserve":
      return store.reserveCall(Number(args[0]));
    case "reindex":
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
    store?.close();
    process.exit(0);
  });
}
