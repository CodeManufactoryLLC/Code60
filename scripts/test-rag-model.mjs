import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const models = join(root, "models");
if (process.argv.includes("--model")) {
  // Any accidental online request fails, even when a machine has credentials or a warm cache.
  globalThis.fetch = async () => {
    throw new Error("Network is forbidden in the offline RAG smoke");
  };
  const started = performance.now();
  const { loadRagModel } = await import("../dist/desktop/rag-model.js");
  const { topMatches, embedMessages, checkedVector, chunkText } = await import(
    "../dist/core/index.js"
  );
  const embedder = await loadRagModel(models);
  const loaded = performance.now();
  const documents = [
    "We decided to keep the database on this laptop. Rebuild the index manually; do not upload conversations.",
    "export async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> { for (let n = 1; ; n++) { try { return await fn(); } catch (error) { if (n >= attempts) throw error; } } }",
    "export function unique<T>(values: T[]): T[] { return [...new Set(values)]; }",
    "To bake the bread, mix flour with water and yeast and leave the dough to rise.",
  ];
  const { vectors } = await embedMessages(
    embedder,
    documents.map((text) => ({ text })),
    768,
  );
  const indexed = performance.now();
  const queries = [
    ["What did we choose about keeping chats private and refreshing search?", 0],
    ["TypeScript retry an asynchronous operation a limited number of times on failure", 1],
    ["Remove duplicate items from a TypeScript array", 2],
  ];
  const rankings = [];
  for (const [text, expected] of queries) {
    const matches = topMatches(await embedder.embedQuery(text), vectors, 768, 4);
    assert.equal(matches[0].index, expected, `Fixed relevance fixture failed: ${text}`);
    rankings.push(matches[0].score);
  }
  const queried = performance.now();
  // Independent upstream model-card reference, not a score produced by our implementation.
  const reference = await embedder.embedDocuments([
    "How do I access the index while iterating over a sequence with a for loop?",
    "# Use the built-in enumerator\nfor idx, x in enumerate(xs):\n    print(idx, x)",
  ]);
  const cosine = reference[0].reduce((sum, value, i) => sum + value * reference[1][i], 0);
  assert.ok(
    Math.abs(cosine - 0.7282) < 0.03,
    `INT8 cosine ${cosine} differs from upstream fp32 0.7282`,
  );
  const worst = " token".repeat(510);
  assert.equal(embedder.countTokens(worst), 512);
  const heavyStarted = performance.now();
  const heavy = await embedder.embedDocuments(Array(8).fill(worst));
  heavy.forEach((vector) => {
    checkedVector(vector, 768);
  });
  const heavyMs = performance.now() - heavyStarted;
  await assert.rejects(embedder.embedQuery(`${worst} token`), /512-token/);
  const long = `${"alpha beta ".repeat(800)}😀${"let x = 1; ".repeat(400)}  `;
  const chunked = await embedMessages(embedder, [{ text: long }], 768);
  const covered = new Uint8Array(long.length);
  for (let i = 1; i < chunked.chunks.length; i++) {
    const overlap = long.slice(chunked.chunks[i].start, chunked.chunks[i - 1].end);
    assert.ok(embedder.countTokens(overlap) - embedder.countTokens("") <= 64);
  }
  for (const chunk of chunked.chunks) {
    assert.equal(chunk.text, long.slice(chunk.start, chunk.end));
    assert.ok(embedder.countTokens(chunk.text) <= 512);
    covered.fill(1, chunk.start, chunk.end);
  }
  assert.ok(
    covered.every((n) => n === 1),
    "Chunking truncated source text",
  );
  const whitespaceStarted = performance.now();
  const whitespaceText = `${"word ".repeat(600)}${" ".repeat(1_000_000)}`;
  const whitespaceChunks = chunkText(whitespaceText, embedder.countTokens);
  assert.equal(whitespaceChunks[0].start, 0);
  assert.equal(whitespaceChunks.at(-1).end, whitespaceText.length);
  for (const [index, span] of whitespaceChunks.entries()) {
    assert.ok(embedder.countTokens(whitespaceText.slice(span.start, span.end)) <= 512);
    if (index) assert.ok(span.start <= whitespaceChunks[index - 1].end);
  }
  const whitespaceChunkMs = performance.now() - whitespaceStarted;
  console.log(
    JSON.stringify(
      {
        coldLoadMs: loaded - started,
        index4DocumentsMs: indexed - loaded,
        queryMeanMs: (queried - indexed) / queries.length,
        relevanceTop1: "3/3",
        scores: rankings,
        upstreamFp32Cosine: 0.7282,
        int8Cosine: cosine,
        batch8x512Ms: heavyMs,
        peakRssMiB: process.resourceUsage().maxRSS / 1024,
        longMessageChunks: chunked.chunks.length,
        whitespaceChunks: whitespaceChunks.length,
        whitespaceChunkMs,
      },
      null,
      2,
    ),
  );
} else {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [fileURLToPath(import.meta.url), "--model"],
    {
      cwd: root,
      timeout: 120_000,
      maxBuffer: 1_048_576,
    },
  );
  console.log(stdout.trim());
  const { RagService } = await import("../dist/desktop/rag-service.js");
  const directory = await mkdtemp(join(tmpdir(), "code60-rag-offline-"));
  const service = new RagService(models);
  service.select(join(directory, "database.sqlite"));
  const identity = () => ({
    databaseKey: service.snapshot().databaseKey,
    requestId: crypto.randomUUID(),
  });
  const at = new Date().toISOString();
  try {
    const started = performance.now();
    await service.rebuild(identity(), async () => [
      {
        source: {
          version: 1,
          kind: "conversation",
          runId: "offline-fixture",
          conversation: "chat",
          title: "Private snapshot",
          agent: "fixture",
          project: null,
        },
        events: [
          {
            type: "prompt",
            text: "Keep conversations on this device.",
            turn: 1,
            runId: "offline-fixture",
            at,
          },
          {
            type: "message",
            text: "The local index is rebuilt only when requested.",
            runId: "offline-fixture",
            at,
          },
        ],
      },
    ]);
    const built = performance.now();
    const result = await service.retrieve({
      ...identity(),
      text: "How do I refresh the local conversation index?",
    });
    assert.equal(result.hits[0].role, "assistant");
    const retrieved = performance.now();
    const restart = new RagService(models);
    restart.select(join(directory, "database.sqlite"));
    assert.equal((await restart.status()).index.chunks, 2);
    await assert.rejects(
      service.retrieve({ ...identity(), text: " token".repeat(511) }),
      /Query exceeds 512 tokens/,
    );
    const unavailable = new RagService(join(directory, "missing-models"));
    unavailable.select(join(directory, "database.sqlite"));
    await assert.rejects(
      unavailable.rebuild(identity(), async () => []),
      /bundled model assets/,
    );
    let cancelled = false;
    const dispose = service.subscribe((status) => {
      if (!cancelled && status.operation?.phase.startsWith("Embedding conversation ")) {
        cancelled = true;
        void service.cancel(status.operation.requestId);
      }
    });
    try {
      await assert.rejects(
        service.rebuild(identity(), async () => [
          {
            source: result.hits[0].source,
            events: [
              { type: "message", runId: "offline-fixture", at, text: " token".repeat(4000) },
            ],
          },
        ]),
        /cancel/i,
      );
    } finally {
      dispose();
    }
    assert.ok(cancelled, "The real worker did not reach batch progress");
    assert.equal((await restart.status()).index.chunks, 2);
    console.log(
      JSON.stringify(
        {
          workerColdBuildMs: built - started,
          workerColdRetrieveMs: retrieved - built,
          persistence: "passed",
          workerCancellationAndFailure: "previous index preserved",
          network: "disabled",
        },
        null,
        2,
      ),
    );
  } finally {
    await service.cancel();
    await rm(directory, { recursive: true, force: true });
  }
}
