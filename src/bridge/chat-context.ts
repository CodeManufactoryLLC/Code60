import { z } from "zod";

z.config({ jitless: true });

/** References identify saved evidence, never filesystem paths or execution authority. */
export const chatReferenceSchema = z
  .strictObject({
    reviewId: z.string().uuid(),
    revisionId: z.string().uuid(),
    fileKey: z.string().min(1).max(8192).optional(),
    side: z.enum(["original", "modified"]).optional(),
    start: z.number().int().positive().max(1_000_000).optional(),
    end: z.number().int().positive().max(1_000_000).optional(),
  })
  .refine((value) =>
    value.start === undefined
      ? value.end === undefined && value.side === undefined
      : !!value.fileKey && !!value.side && value.end !== undefined && value.end >= value.start,
  );
export type ChatReference = z.infer<typeof chatReferenceSchema>;
export interface ChatUndoResult {
  type: "rewound";
  checkpointId: string;
  text: string;
  references?: ChatReference[];
}
