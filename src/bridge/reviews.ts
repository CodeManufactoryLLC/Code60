import { z } from "zod";

const uuid = z.string().uuid();
const run = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
const text = z.string().max(8_000);
const key = z.string().min(1).max(2_048);
const project = z.string().min(1).max(4_096);
export const reviewAnchorSchema = z
  .strictObject({
    revisionId: uuid,
    fileKey: key,
    side: z.enum(["original", "modified"]),
    start: z.number().int().min(1).max(1_000_000),
    end: z.number().int().min(1).max(1_000_000),
  })
  .refine((value) => value.end >= value.start && value.end - value.start <= 200);
export const reviewFileSchema = z.strictObject({
  key,
  runId: run,
  path: key,
  oldPath: key,
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  fingerprint: z.string().max(160),
  limitation: z.string().max(200).optional(),
});
export const reviewRevisionSchema = z.strictObject({
  id: uuid,
  at: z.string(),
  files: z.array(reviewFileSchema).max(2_000),
  sources: z
    .array(
      z.strictObject({
        runId: run,
        base: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
        commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
      }),
    )
    .max(100)
    .optional(),
  errors: z.array(z.strictObject({ runId: run, message: z.string().max(2_000) })).max(100),
});
export const reviewCommentSchema = z.strictObject({
  id: uuid,
  text,
  anchor: reviewAnchorSchema.optional(),
  revisionId: uuid,
  state: z.enum(["draft", "sent", "resolved"]),
  addressed: z.string().max(2_000).optional(),
});
export const reviewSubmissionSchema = z.strictObject({
  deliveredTurn: z.number().int().min(1).optional(),
  deliveredChatId: run.optional(),
  id: uuid,
  revisionId: uuid,
  commentIds: z.array(uuid).min(1).max(100),
  state: z.enum(["pending", "delivering", "delivered", "failed", "withdrawn"]),
  error: z.string().max(2_000).optional(),
});
export const reviewSchema = z.strictObject({
  version: z.number().int().min(0).default(0),
  format: z.literal(1),
  id: uuid,
  project,
  title: z.string().max(160),
  originChatId: run.nullable(),
  chatId: run.nullable(),
  turn: z.number().int().min(0),
  workers: z.array(z.strictObject({ runId: run, label: z.string().max(160) })).max(100),
  revisions: z.array(reviewRevisionSchema).max(100),
  comments: z.array(reviewCommentSchema).max(1_000),
  submissions: z.array(reviewSubmissionSchema).max(100),
  reviewed: z.record(key, z.string().max(160)),
  error: z.string().max(2_000).optional(),
});
export type Review = z.infer<typeof reviewSchema>;
export type ReviewSummary = Pick<
  Review,
  | "id"
  | "version"
  | "project"
  | "title"
  | "chatId"
  | "originChatId"
  | "turn"
  | "workers"
  | "submissions"
> & { revisions: Pick<ReviewRevision, "id" | "at">[] };
export type ReviewRevision = z.infer<typeof reviewRevisionSchema>;
export type ReviewFile = z.infer<typeof reviewFileSchema>;
export type ReviewAnchor = z.infer<typeof reviewAnchorSchema>;
export interface ReviewContent {
  file: ReviewFile;
  original: string;
  modified: string;
}

const identity = { project, reviewId: uuid };
export const reviewActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("open-run"), project, runId: run }),
  z.strictObject({ type: z.literal("reconnect"), ...identity, chatId: run }),
  z.strictObject({
    type: z.literal("comment"),
    ...identity,
    id: uuid,
    revisionId: uuid,
    text,
    anchor: reviewAnchorSchema.optional(),
  }),
  z.strictObject({ type: z.literal("delete-comment"), ...identity, id: uuid }),
  z.strictObject({ type: z.literal("resolve"), ...identity, id: uuid, resolved: z.boolean() }),
  z.strictObject({
    type: z.literal("reviewed"),
    ...identity,
    revisionId: uuid,
    fileKey: key,
    reviewed: z.boolean(),
  }),
  z.strictObject({ type: z.literal("submit"), ...identity, id: uuid, revisionId: uuid }),
  z.strictObject({ type: z.literal("withdraw"), ...identity, id: uuid }),
  z.strictObject({ type: z.literal("retry"), ...identity, id: uuid }),
]);
export const reviewReadSchema = z.strictObject({ ...identity, requestId: uuid });
export const reviewFileReadSchema = z.strictObject({
  ...identity,
  requestId: uuid,
  revisionId: uuid,
  fileKey: key,
});
export type ReviewAction = z.infer<typeof reviewActionSchema>;
export type ReviewRead = z.infer<typeof reviewReadSchema>;
export type ReviewFileRead = z.infer<typeof reviewFileReadSchema>;
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value, { jitless: true });
  if (!result.success) throw new Error("Invalid review request");
  return result.data;
}
export const parseReviewAction = (value: unknown) => parse(reviewActionSchema, value);
export const parseReviewRead = (value: unknown) => parse(reviewReadSchema, value);
export const parseReviewFileRead = (value: unknown) => parse(reviewFileReadSchema, value);
