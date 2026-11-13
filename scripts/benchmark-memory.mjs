import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Offline guarantee: any network request fails the benchmark.
globalThis.fetch = async () => {
  throw new Error("Network is forbidden in the memory benchmark");
};
const root = fileURLToPath(new URL("../", import.meta.url));
const { MemoryStore } = await import("../dist/desktop/memory-store.js");
const { indexMemoryBatch, memorySearch, MEMORY_MODEL } = await import(
  "../dist/desktop/memory-worker.js"
);
const { loadRagModel } = await import("../dist/desktop/rag-model.js");

const topics = [
  "The release pipeline signs macOS builds with the team notarization profile",
  "Database migrations run inside a single transaction and roll back on failure",
  "The sidebar collapses below nine hundred pixels to keep the editor readable",
  "Log rotation keeps seven days of private diagnostic segments",
  "Windows installers need the job object helper for process cleanup",
  "The tactics picker remembers the last selection per chat",
  "Prompt templates are validated again in the main process before saving",
  "Search summaries cite numbered evidence from saved conversations",
  "Worker updates are delivered only between orchestration turns",
  "Git setup creates an initial commit only after explicit confirmation",
];
const conversations = Number(process.env.MEMORY_BENCH_CONVERSATIONS ?? 50);
const perConversation = 20;
const scanRecords = Number(process.env.MEMORY_BENCH_SCAN_RECORDS ?? 10_000);
const dir = await mkdtemp(join(tmpdir(), "code60-memory-bench-"));
const mem = () => process.memoryUsage().rss / 1048576;
let peak = mem();
const sample = () => {
  peak = Math.max(peak, mem());
};
function publish(db, cid, texts, at) {
  const text = `Fixture evidence ${randomUUID()}`;
  const s = {
    id: randomUUID(),
    conversationId: cid,
    role: "human",
    at,
    ordinal: 1,
    start: 0,
    text,
  };
  db.append(cid, "1", [s], true);
  const citations = [{ sourceId: s.id, start: 0, end: text.length, quote: text }];
  const range = db.range(cid);
  db.publish(
    cid,
    range.cursor,
    range.boundary,
    {
      goal: "",
      constraints: [],
      decisions: [],
      attempts: [],
      questions: [],
      next: "",
      citations,
      memories: texts.map((t, i) => ({
        type: "semantic",
        text: t,
        subject: `${cid}-${i}`,
        condition: "",
        correction: false,
        citations,
      })),
    },
    "benchmark",
  );
}
try {
  const projectA = join(dir, "a");
  const projectB = join(dir, "b");
  await mkdir(projectA);
  await mkdir(projectB);
  const db = new MemoryStore(join(dir, "memory"));
  const target = "Integration tests fail unless the Redis cache container is started first.";
  const old = new Date(Date.now() - 90 * 86400000).toISOString();
  const first = db.register("bench:0", "Oldest", projectA);
  publish(db, first.id, [target], old);
  for (let c = 1; c < conversations; c++) {
    const reg = db.register(`bench:${c}`, `Chat ${c}`, projectA);
    publish(
      db,
      reg.id,
      Array.from(
        { length: perConversation },
        (_, i) => `${topics[(c + i) % topics.length]} (note ${c}.${i}).`,
      ),
      new Date().toISOString(),
    );
  }
  const other = db.register("bench:other", "Other project", projectB);
  publish(
    db,
    other.id,
    ["Before running the test suite, start the Redis server in Docker."],
    new Date().toISOString(),
  );
  const reader = db.register("bench:reader", "New chat", projectA);
  const total = db.snapshot().indexPending;
  sample();

  const coldStart = performance.now();
  const model = await loadRagModel(join(root, "models"));
  const coldLoadMs = performance.now() - coldStart;
  sample();
  const load = async () => model;
  const query = "Which service has to be running before the checks can pass?";
  const lexicalOnly = await memorySearch(db, reader.id, query, load);
  const indexStart = performance.now();
  let batches = 0;
  let worstBatchMs = 0;
  for (;;) {
    const t = performance.now();
    const more = await indexMemoryBatch(db, load);
    if (!more) break;
    batches++;
    worstBatchMs = Math.max(worstBatchMs, performance.now() - t);
    sample();
  }
  const indexMs = performance.now() - indexStart;
  assert.equal(db.snapshot().indexPending, 0);

  const coldQuery = performance.now();
  const recalled = await memorySearch(db, reader.id, query, load);
  const coldQueryMs = performance.now() - coldQuery;
  const warm = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    await memorySearch(db, reader.id, query, load);
    warm.push(performance.now() - t);
  }
  sample();
  const rank = recalled.records.findIndex((r) => r.text === target);
  assert.ok(rank >= 0 && rank < 3, `Paraphrased recall rank ${rank}`);
  assert.ok(
    recalled.records.every((r) => r.projectId === first.projectId),
    "Scope leaked",
  );
  assert.equal(recalled.warning, undefined);

  // Scan cost at larger scale uses synthetic vectors; relevance above uses real embeddings.
  const scale = db.register("bench:scale", "Scale", projectA);
  const extra = Math.max(0, scanRecords - total);
  for (let c = 0; c < Math.ceil(extra / perConversation); c++) {
    const reg = db.register(`bench:scale:${c}`, `Scale ${c}`, projectA);
    publish(
      db,
      reg.id,
      Array.from(
        { length: perConversation },
        (_, i) => `Synthetic scale record ${c}.${i} about ${topics[i % topics.length]}`,
      ),
      new Date().toISOString(),
    );
  }
  const unit = Float32Array.from({ length: 768 }, (_, i) => (i === 1 ? 1 : 0));
  for (;;) {
    const page = db.unindexed(MEMORY_MODEL, 256);
    if (!page.length) break;
    for (const r of page) db.setVectors(r.id, MEMORY_MODEL, [unit]);
  }
  sample();
  const scaleTimes = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    const result = await memorySearch(db, scale.id, query, load);
    scaleTimes.push(performance.now() - t);
    assert.ok(result.records.some((r) => r.text === target));
  }
  sample();
  db.close();
  console.log(
    JSON.stringify(
      {
        conversations,
        realEmbeddedRecords: total,
        lexicalOnlyBeforeIndexWarning: lexicalOnly.warning ?? null,
        coldModelLoadMs: Math.round(coldLoadMs),
        indexLagMs: Math.round(indexMs),
        indexBatches: batches,
        worstIndexBatchMs: Math.round(worstBatchMs),
        coldQueryMs: Math.round(coldQueryMs),
        warmQueryMaxMs: Math.round(Math.max(...warm)),
        paraphraseRank: rank + 1,
        scanRecords: Math.max(scanRecords, total),
        scanQueryMaxMs: Math.round(Math.max(...scaleTimes)),
        peakRssMiB: Math.round(
          Math.max(
            peak,
            process.resourceUsage().maxRSS / 1024 / (process.platform === "darwin" ? 1024 : 1),
          ),
        ),
        network: "disabled",
      },
      null,
      2,
    ),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
