import { z } from "zod";
import { parseValue, runIdSchema } from "../contracts/index.js";
import type { DesktopRun, OrchestrationChat, SequencedEvent, Snapshot } from "./index.js";
import type { RelayFileDetails } from "./relay-files.js";

const generation = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const project = { projectId: z.string().uuid(), databaseEpoch: generation };
const conversation = z
  .strictObject({
    kind: z.literal("conversation"),
    conversationId: runIdSchema,
    generation,
    projectId: project.projectId.optional(),
    databaseEpoch: generation.optional(),
  })
  .refine(
    (scope) => (scope.projectId === undefined) === (scope.databaseEpoch === undefined),
    "Project identity and database epoch are required together",
  );
const scopeSchema = z.union([
  z.strictObject({ kind: z.literal("project"), ...project }),
  conversation,
  z.strictObject({
    kind: z.literal("target"),
    targetId: z.string().uuid(),
    conversationId: z.string().uuid(),
    generation,
  }),
]);
const requestSchema = z.strictObject({ subscriptionId: z.string().uuid(), scope: scopeSchema });
const identitySchema = z.strictObject({ subscriptionId: z.string().uuid() });
export type DetailScope = z.infer<typeof scopeSchema>;
export type DetailRequest = z.infer<typeof requestSchema>;
export type DetailIdentity = z.infer<typeof identitySchema>;
export function detailScopeKey(scope: DetailScope): string {
  switch (scope.kind) {
    case "project":
      return JSON.stringify([scope.kind, scope.projectId, scope.databaseEpoch]);
    case "conversation":
      return JSON.stringify([
        scope.kind,
        scope.conversationId,
        scope.generation,
        scope.projectId ?? null,
        scope.databaseEpoch ?? null,
      ]);
    case "target":
      return JSON.stringify([scope.kind, scope.conversationId, scope.generation, scope.targetId]);
  }
}
export type DetailPayload =
  | ({ kind: "conversation"; chat: OrchestrationChat } & RelayFileDetails)
  | ({
      kind: "project";
      projectId: string;
      databaseEpoch: number;
    } & Pick<
      Snapshot,
      "directory" | "runs" | "events" | "files" | "worktrees" | "reviews" | "liveIds"
    >)
  | ({
      kind: "target";
      targetId: string;
      cwd: string;
      runs: DesktopRun[];
      events: SequencedEvent[];
    } & RelayFileDetails);
export type DetailFrame = {
  subscriptionId: string;
  scope: DetailScope;
  revision: number;
  previousRevision: number | null;
} & ({ closed: true } | { closed: false; payload: DetailPayload });
export const parseDetailRequest = (value: unknown): DetailRequest =>
  parseValue(requestSchema, value);
export const parseDetailIdentity = (value: unknown): DetailIdentity =>
  parseValue(identitySchema, value);
