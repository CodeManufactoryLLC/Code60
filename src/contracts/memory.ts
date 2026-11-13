import { z } from "zod";

z.config({ jitless: true });
export const MEMORY_TYPES = ["episodic", "semantic", "lesson", "history"] as const;
const memoryTypeSchema = z.enum(MEMORY_TYPES);
const text = z.string().min(1).max(2000);
const id = z.string().uuid();
export const memorySettingsSchema = z.strictObject({
  enabled: z.boolean(),
  relay: z.boolean(),
  project: z.boolean(),
  worker: z.boolean(),
  continuity: z.boolean(),
  capture: z.boolean(),
  recall: z.boolean(),
  generation: z.boolean(),
  rolloverPercent: z.number().int().min(30).max(85),
  capacity: z.number().int().min(1024).max(2_000_000),
  checkpointTokens: z.number().int().min(128).max(8000),
  recallTokens: z.number().int().min(0).max(16000),
  cadenceSeconds: z.number().int().min(0).max(3600),
  dailyCalls: z.number().int().min(1).max(1000),
  types: z.strictObject({
    episodic: z.boolean(),
    semantic: z.boolean(),
    lesson: z.boolean(),
    history: z.boolean(),
  }),
  generateTypes: z.strictObject({
    episodic: z.boolean(),
    semantic: z.boolean(),
    lesson: z.boolean(),
    history: z.boolean(),
  }),
  retentionDays: z.strictObject({
    episodic: z.number().int().min(0).max(3650),
    semantic: z.number().int().min(0).max(3650),
    lesson: z.number().int().min(0).max(3650),
    history: z.number().int().min(0).max(3650),
  }),
});
export type MemorySettings = z.infer<typeof memorySettingsSchema>;
export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  relay: true,
  project: true,
  worker: true,
  continuity: true,
  capture: true,
  recall: true,
  generation: true,
  rolloverPercent: 70,
  capacity: 32000,
  checkpointTokens: 2000,
  recallTokens: 4000,
  cadenceSeconds: 30,
  dailyCalls: 50,
  types: { episodic: true, semantic: true, lesson: true, history: true },
  generateTypes: { episodic: true, semantic: true, lesson: true, history: true },
  retentionDays: { episodic: 0, semantic: 0, lesson: 0, history: 0 },
};
export const memorySourceSchema = z.strictObject({
  id,
  conversationId: id,
  role: z.enum(["human", "assistant"]),
  at: z.string().datetime(),
  text: z.string().min(1).max(32000),
  ordinal: z.number().int().nonnegative(),
  start: z.number().int().nonnegative(),
});
export type MemorySource = z.infer<typeof memorySourceSchema>;
const memoryCitationSchema = z.strictObject({
  sourceId: id,
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  quote: z.string().min(1).max(2000),
});
const memoryCandidateSchema = z.strictObject({
  type: memoryTypeSchema,
  text,
  subject: z.string().min(1).max(128),
  condition: z.string().max(1000),
  correction: z.boolean(),
  citations: z.array(memoryCitationSchema).min(1).max(8),
});
export const memoryGenerationSchema = z.strictObject({
  goal: z.string().max(2000),
  constraints: z.array(text).max(12),
  decisions: z.array(text).max(12),
  attempts: z.array(text).max(12),
  questions: z.array(text).max(12),
  next: z.string().max(2000),
  citations: z.array(memoryCitationSchema).max(32),
  memories: z.array(memoryCandidateSchema).max(32),
});
export type MemoryGeneration = z.infer<typeof memoryGenerationSchema>;
export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>;
export const memoryRecordSchema = memoryCandidateSchema.extend({
  id,
  version: z.literal(1),
  revision: z.number().int().positive(),
  conversationId: id,
  projectId: id.nullable(),
  scope: z.enum(["conversation", "project", "global"]),
  evidence: z.enum(["user-stated", "agent-reported", "human-edited"]),
  state: z.enum(["active", "disputed", "stale", "superseded", "forgotten"]),
  pinned: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  eventAt: z.string().datetime(),
  provider: z.string().max(256),
  promptVersion: z.literal(1),
  supersedes: id.nullable(),
  lastUsedAt: z.string().datetime().nullable(),
});
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;
export const memoryBrowseSchema = z.strictObject({
  projectId: id.optional(),
  conversationId: id.optional(),
  type: memoryTypeSchema.optional(),
  state: memoryRecordSchema.shape.state.optional(),
  cursor: id.optional(),
});
export const memoryActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("configure"), settings: memorySettingsSchema }),
  z.strictObject({
    type: z.literal("edit"),
    id,
    revision: z.number().int().positive(),
    text,
    pinned: z.boolean(),
  }),
  z.strictObject({ type: z.literal("promote"), id, revision: z.number().int().positive() }),
  z.strictObject({ type: z.literal("forget"), id, revision: z.number().int().positive() }),
  z.strictObject({ type: z.literal("resolve"), id, revision: z.number().int().positive() }),
  z.strictObject({ type: z.literal("remember"), conversationId: id, enabled: z.boolean() }),
  z.strictObject({ type: z.literal("generate"), conversationId: id }),
  z.strictObject({ type: z.literal("reindex") }),
  z.strictObject({ type: z.literal("forget-scope"), projectId: id.nullable() }),
]);
export type MemoryAction = z.infer<typeof memoryActionSchema>;
export type MemoryBrowse = z.infer<typeof memoryBrowseSchema>;
export interface MemorySnapshot {
  settings: MemorySettings;
  provider: string | null;
  warning: string | null;
  busy: boolean;
  count: number;
  bytes: number;
  dailyCalls: number;
  indexPending: number;
  projects: { id: string; label: string }[];
  conversations: { id: string; label: string; remember: boolean }[];
}
export interface MemoryPage {
  records: MemoryRecord[];
  next: string | null;
}
export interface MemoryDetail {
  record: MemoryRecord;
  sources: MemorySource[];
  revisions: { revision: number; text: string; at: string }[];
  incomplete: boolean;
}
