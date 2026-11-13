import { z } from "zod";
import { parseValue } from "../contracts/index.js";
import { type Review, type ReviewContent, reviewAnchorSchema } from "./reviews.js";
import type { TaskView } from "./tasks.js";

const uuid = z.string().uuid();
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const identity = { conversationId: uuid, generation: integer };
const review = { ...identity, targetId: uuid, reviewId: uuid };
const key = z.string().min(1).max(2_048);
const feedback = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("comment"),
    id: uuid,
    revisionId: uuid,
    text: z.string().max(8_000),
    anchor: reviewAnchorSchema.optional(),
  }),
  z.strictObject({ type: z.literal("delete-comment"), id: uuid }),
  z.strictObject({ type: z.literal("resolve"), id: uuid, resolved: z.boolean() }),
  z.strictObject({
    type: z.literal("reviewed"),
    revisionId: uuid,
    fileKey: key,
    reviewed: z.boolean(),
  }),
  z.strictObject({ type: z.literal("submit"), id: uuid, revisionId: uuid }),
  z.strictObject({ type: z.enum(["withdraw", "retry"]), id: uuid }),
]);
const task = z.discriminatedUnion("type", [
  z.strictObject({ type: z.enum(["status", "cancel"]) }),
  z.strictObject({ type: z.literal("prepare"), revisionId: uuid }),
  z.strictObject({ type: z.literal("file"), operationId: uuid, fileId: uuid }),
  z.strictObject({
    type: z.enum(["apply", "undo", "recover", "revise"]),
    operationId: uuid,
  }),
]);
const requestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...identity, type: z.literal("list"), cursor: uuid.optional() }),
  z.strictObject({
    ...review,
    type: z.literal("read"),
    requestId: uuid,
    revisionId: uuid.optional(),
  }),
  z.strictObject({ ...review, type: z.literal("capture"), requestId: uuid }),
  z.strictObject({
    ...review,
    type: z.literal("file"),
    requestId: uuid,
    revisionId: uuid,
    fileKey: key,
  }),
  z.strictObject({ ...review, type: z.literal("action"), action: feedback }),
  z.strictObject({ ...review, type: z.literal("task"), action: task }),
  z.strictObject({ ...review, type: z.literal("cancel"), requestId: uuid }),
]);
export const relayReviewEntrySchema = z.strictObject({
  id: uuid,
  taskId: uuid,
  targetId: uuid,
  generation: integer,
  title: z.string().max(160),
  targetLabel: z.string().max(512),
  labelTruncated: z.boolean(),
  workspaceMode: z.enum(["direct", "worktree"]),
  at: z.string().datetime(),
});
export type RelayReviewEntry = z.infer<typeof relayReviewEntrySchema>;
export type RelayReviewRequest = z.infer<typeof requestSchema>;
export type RelayReviewResponse =
  | { type: "list"; entries: RelayReviewEntry[]; cursor: string | null }
  | { type: "review"; review: Review; live: boolean }
  | { type: "file"; content: ReviewContent }
  | { type: "task"; task: TaskView }
  | { type: "done" };
export const parseRelayReview = (value: unknown): RelayReviewRequest =>
  parseValue(requestSchema, value);
