import { z } from "zod";
import { parseValue } from "../contracts/index.js";
import type { RagSource } from "../core/index.js";

export const RAG_QUERY_LIMIT = 8192;
const identity = z.strictObject({
  databaseKey: z.string().regex(/^[a-f0-9]{64}$/),
  requestId: z.string().uuid(),
  databaseEpoch: z.number().int().nonnegative().optional(),
});
const query = identity.extend({
  text: z
    .string()
    .min(1)
    .max(RAG_QUERY_LIMIT)
    .refine((s) => s.trim().length > 0),
});
export type RagIdentity = z.infer<typeof identity>;
export type RagQuery = z.infer<typeof query>;
export const parseRagIdentity = (value: unknown): RagIdentity => parseValue(identity, value);
export const parseRagQuery = (value: unknown): RagQuery => parseValue(query, value);
export const parseRagCancel = (value: unknown): string => parseValue(z.string().uuid(), value);
export interface RagSummary {
  builtAt: string;
  conversations: number;
  chunks: number;
}
export interface RagStatus {
  databaseKey: string | null;
  revision: number;
  model: string;
  index: RagSummary | null;
  operation: { requestId: string; phase: string; completed: number; total: number } | null;
  error: string | null;
}
export interface RagHit {
  message: number;
  source: RagSource;
  role: "user" | "assistant";
  at: string;
  start: number;
  end: number;
  text: string;
  score: number;
}
export interface RagResults {
  databaseKey: string;
  generation: string;
  hits: RagHit[];
}
