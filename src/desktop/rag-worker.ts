import {
  conversationMessages,
  embedMessages,
  type RagSource,
  type RunEvent,
  topMatches,
} from "../core/index.js";
import { RAG_LIMITS, RagStore, type StoredChunk } from "./rag-store.js";

export interface RagConversation {
  source: RagSource;
  events: RunEvent[];
}
export type RagWork = {
  root: string;
  databaseKey: string;
  modelRoot: string;
} & (
  | { action: "build"; generation: string; sources: RagConversation[] }
  | { action: "retrieve"; text: string }
);

async function run(work: RagWork) {
  const store = new RagStore(work.root, work.databaseKey);
  process.send?.({ progress: { phase: "Loading bundled model", completed: 0, total: 0 } });
  if (work.action === "retrieve") {
    const manifest = await store.manifest();
    if (!manifest) throw new Error("Index conversations before retrieving");
    const index = await store.load(manifest);
    const { loadRagModel } = await import("./rag-model.js");
    const embedder = await loadRagModel(work.modelRoot);
    if (embedder.countTokens(work.text) > 512)
      throw new Error("Query exceeds 512 tokens. Shorten the message.");
    const query = await embedder.embedQuery(work.text);
    return {
      databaseKey: work.databaseKey,
      generation: manifest.generation,
      hits: topMatches(query, index.vectors, 768, 10).map(({ index: i, score }) => ({
        ...index.chunks[i],
        score,
      })),
    };
  }
  const { loadRagModel } = await import("./rag-model.js");
  const embedder = await loadRagModel(work.modelRoot);
  const chunks: StoredChunk[] = [];
  const vectors: Float32Array[] = [];
  let total = 0;
  for (const [i, conversation] of work.sources.entries()) {
    const messages = conversationMessages(conversation.events);
    const result = await embedMessages(embedder, messages, 768, 8, {
      maxChunks: RAG_LIMITS.chunks - total,
      progress: (completed, count) =>
        process.send?.({
          progress: {
            phase: `Embedding conversation ${i + 1} / ${work.sources.length}`,
            completed,
            total: count,
          },
        }),
    });
    total += result.chunks.length;
    if (total > RAG_LIMITS.chunks)
      throw new Error("RAG supports at most 10,000 chunks. The previous index was kept.");
    for (const chunk of result.chunks) {
      const message = messages[chunk.message];
      if (!message) throw new Error("Missing message provenance");
      chunks.push({
        message: chunk.message,
        source: conversation.source,
        role: message.role,
        at: message.at,
        start: chunk.start,
        end: chunk.end,
        text: chunk.text,
      });
    }
    vectors.push(result.vectors);
    process.send?.({
      progress: { phase: "Embedding conversations", completed: i + 1, total: work.sources.length },
    });
  }
  const flat = new Float32Array(total * 768);
  let offset = 0;
  for (const vector of vectors) {
    flat.set(vector, offset);
    offset += vector.length;
  }
  await store.stage(work.generation, { chunks, vectors: flat });
  return { builtAt: new Date().toISOString(), conversations: work.sources.length, chunks: total };
}

process.once("message", (work: RagWork) => {
  void run(work).then(
    (result) => process.send?.({ result }, () => process.disconnect()),
    (error: unknown) => {
      // Only our fixed validation errors cross IPC; never forward model/runtime/source payloads.
      const text =
        error instanceof Error &&
        /^(Query exceeds|Index conversations|RAG supports|RAG index exceeds|A RAG message exceeds|Invalid RAG|The RAG)/.test(
          error.message,
        )
          ? error.message
          : "RAG operation failed. Verify bundled model assets and readable histories, then rebuild.";
      process.send?.({ error: text }, () => process.disconnect());
    },
  );
});
