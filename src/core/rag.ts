import type { RunEvent } from "./types.js";

/** Bump the version whenever chunk boundaries or embedded text change. */
export const RAG_CHUNKER = {
  id: "message-tokens",
  version: 2,
  maxTokens: 512,
  overlapTokens: 64,
} as const;

/**
 * Where a chunk came from. Future repository sources add their own kinds (file path, symbol,
 * line range) rather than reusing conversation fields.
 */
interface RagConversationSource {
  version: 1;
  kind: "conversation";
  runId: string;
  conversation: "chat" | "worker";
  title: string;
  agent: string;
  project: string | null;
}
export type RagSource = RagConversationSource;

export interface RagMessage {
  role: "user" | "assistant";
  at: string;
  text: string;
}

/** Text-to-vector operations. Query and document embeddings may differ for some models. */
export interface RagEmbedder {
  /** Token count including the model's special tokens. */
  countTokens(text: string): number;
  embedDocuments(texts: readonly string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
}

export interface RagSpan {
  start: number;
  end: number;
}

/** Human prompts and assistant replies, with streamed reply chunks merged into one message. */
export function conversationMessages(events: readonly RunEvent[]): RagMessage[] {
  const messages: RagMessage[] = [];
  let reply: RagMessage | undefined;
  const close = () => {
    if (reply?.text.trim()) messages.push(reply);
    reply = undefined;
  };
  for (const event of events) {
    if (event.type === "message") {
      reply ??= { role: "assistant", at: event.at, text: "" };
      reply.text += event.text;
    } else if (event.type === "acp" || event.type === "sessionState") {
      // Raw ACP copies and session metadata do not interrupt a streamed reply.
    } else {
      close();
      // Automatic prompts are Code60 worker updates, not human requests.
      if (event.type === "prompt" && event.origin !== "automatic" && event.text.trim())
        messages.push({ role: "user", at: event.at, text: event.text });
    }
  }
  close();
  return messages;
}

interface Piece extends RagSpan {
  cost: number;
}

/**
 * Splits text into spans of at most `maxTokens` model tokens, special tokens included, overlapping
 * by up to `overlapTokens`. Spans cover every non-whitespace character; nothing is truncated.
 */
export function chunkText(
  text: string,
  countTokens: (text: string) => number,
  maxTokens: number = RAG_CHUNKER.maxTokens,
  overlapTokens: number = RAG_CHUNKER.overlapTokens,
): RagSpan[] {
  if (
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    !Number.isInteger(overlapTokens) ||
    overlapTokens < 0
  )
    throw new Error("Invalid chunk token limits");
  if (!text.trim()) return [];
  if (countTokens(text) <= maxTokens) return [{ start: 0, end: text.length }];
  const special = countTokens("");
  const budget = maxTokens - special;
  if (budget < 1) throw new Error("The token limit leaves no room for text");
  const costs = new Map<string, number>();
  const cost = (value: string) => {
    let known = costs.get(value);
    if (known === undefined) {
      known = countTokens(value) - special;
      if (costs.size < 100_000) costs.set(value, known);
    }
    return known;
  };
  const pieces: Piece[] = [];
  const appendPieces = (from: number, end: number) => {
    let start = from;
    while (start < end) {
      // Bound tokenizer work for unbroken strings; use overlap-sized pieces so code also overlaps.
      const candidateEnd = codePointBoundary(text, Math.min(end, start + 4096));
      const pieceBudget =
        candidateEnd < end || end - from > 256
          ? Math.min(budget, Math.max(1, overlapTokens))
          : budget;
      const whole = cost(text.slice(start, candidateEnd));
      if (whole <= pieceBudget) {
        pieces.push({ start, end: candidateEnd, cost: whole });
        start = candidateEnd;
        continue;
      }
      // An unbroken run longer than the budget, such as minified code, splits by code point.
      let low = start + 1;
      let high = candidateEnd;
      while (low < high) {
        const middle = codePointBoundary(text, Math.ceil((low + high) / 2));
        if (middle <= low) break;
        if (cost(text.slice(start, middle)) <= pieceBudget) low = middle;
        else high = middle - 1;
      }
      const cut = Math.max(codePointBoundary(text, low), nextCodePoint(text, start));
      if (countTokens(text.slice(start, cut)) > maxTokens)
        throw new Error("A single character exceeds the token limit");
      pieces.push({ start, end: cut, cost: cost(text.slice(start, cut)) });
      start = cut;
    }
  };
  let previousEnd = 0;
  for (const match of text.matchAll(/\S+/g)) {
    const end = match.index + match[0].length;
    appendPieces(previousEnd, end);
    previousEnd = end;
  }
  appendPieces(previousEnd, text.length);
  const spans: RagSpan[] = [];
  let first = 0;
  while (first < pieces.length) {
    let last = first;
    let total = pieces[first]?.cost ?? 0;
    while (last + 1 < pieces.length && total + (pieces[last + 1]?.cost ?? 0) <= budget) {
      last += 1;
      total += pieces[last]?.cost ?? 0;
    }
    // Tokenization is not strictly additive across pieces, so verify the actual span.
    const start = pieces[first]?.start ?? 0;
    while (last > first && countTokens(text.slice(start, pieces[last]?.end)) > maxTokens) last -= 1;
    const end = pieces[last]?.end ?? text.length;
    if (countTokens(text.slice(start, end)) > maxTokens)
      throw new Error("A chunk exceeds the token limit");
    spans.push({ start, end });
    if (last + 1 >= pieces.length) break;
    let next = last + 1;
    let overlap = 0;
    while (next - 1 > first && overlap + (pieces[next - 1]?.cost ?? 0) <= overlapTokens) {
      next -= 1;
      overlap += pieces[next]?.cost ?? 0;
    }
    while (
      next <= last &&
      countTokens(text.slice(pieces[next]?.start, end)) - special > overlapTokens
    )
      next += 1;
    first = next;
  }
  return spans;
}

function codePointBoundary(text: string, index: number): number {
  const code = text.charCodeAt(index);
  return index > 0 && code >= 0xdc00 && code <= 0xdfff ? index - 1 : index;
}

function nextCodePoint(text: string, index: number): number {
  const code = text.charCodeAt(index);
  return index + (code >= 0xd800 && code <= 0xdbff ? 2 : 1);
}

export interface RagIndexedChunk extends RagSpan {
  /** Index of the message in the input list. */
  message: number;
  text: string;
}

/** Chunks and embeds messages, returning vectors in chunk order as one flat array. */
export async function embedMessages(
  embedder: RagEmbedder,
  messages: readonly { text: string }[],
  dimensions: number,
  batchSize = 8,
  options: { maxChunks?: number; progress?: (completed: number, total: number) => void } = {},
): Promise<{ chunks: RagIndexedChunk[]; vectors: Float32Array }> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 8)
    throw new Error("Invalid embedding batch size");
  if (messages.some((message) => new TextEncoder().encode(message.text).byteLength > 1_048_576))
    throw new Error("A RAG message exceeds the 1 MiB text limit");
  const chunks: RagIndexedChunk[] = [];
  for (const [index, message] of messages.entries()) {
    for (const span of chunkText(message.text, (text) => embedder.countTokens(text))) {
      if (chunks.length >= (options.maxChunks ?? 10_000))
        throw new Error("RAG supports at most 10,000 chunks");
      chunks.push({ ...span, message: index, text: message.text.slice(span.start, span.end) });
    }
  }
  const vectors = new Float32Array(chunks.length * dimensions);
  // Similar lengths in a batch reduce padding work; vectors keep the original chunk order.
  const order = chunks
    .map((_, index) => index)
    .sort((a, b) => {
      const left = chunks[a]?.text.length ?? 0;
      const right = chunks[b]?.text.length ?? 0;
      return left - right || a - b;
    });
  for (let offset = 0; offset < order.length; offset += batchSize) {
    const batch = order.slice(offset, offset + batchSize);
    const embedded = await embedder.embedDocuments(batch.map((index) => chunks[index]?.text ?? ""));
    if (embedded.length !== batch.length) throw new Error("The embedding model returned no vector");
    batch.forEach((index, position) => {
      vectors.set(checkedVector(embedded[position], dimensions), index * dimensions);
    });
    options.progress?.(Math.min(offset + batchSize, order.length), order.length);
  }
  return { chunks, vectors };
}

export function checkedVector(vector: Float32Array | undefined, dimensions: number): Float32Array {
  if (!vector || vector.length !== dimensions || !vector.every(Number.isFinite))
    throw new Error("The embedding model returned an invalid vector");
  const norm = Math.hypot(...vector);
  if (Math.abs(norm - 1) > 0.001) throw new Error("The embedding vector is not normalized");
  return vector;
}

/** Highest cosine similarities of normalized vectors; equal scores keep chunk order. */
export function topMatches(
  query: Float32Array,
  vectors: Float32Array,
  dimensions: number,
  limit: number,
): { index: number; score: number }[] {
  if (
    !Number.isInteger(dimensions) ||
    dimensions < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    query.length !== dimensions ||
    vectors.length % dimensions !== 0 ||
    !query.every(Number.isFinite) ||
    !vectors.every(Number.isFinite)
  )
    throw new Error("Vector dimensions do not match the index");
  const best: { index: number; score: number }[] = [];
  const count = vectors.length / dimensions;
  for (let index = 0; index < count; index++) {
    let score = 0;
    const offset = index * dimensions;
    for (let dimension = 0; dimension < dimensions; dimension++)
      score += (query[dimension] ?? 0) * (vectors[offset + dimension] ?? 0);
    if (best.length === limit && score <= (best.at(-1)?.score ?? -Infinity)) continue;
    let position = best.length;
    while (position > 0 && (best[position - 1]?.score ?? 0) < score) position -= 1;
    best.splice(position, 0, { index, score });
    if (best.length > limit) best.pop();
  }
  return best;
}
