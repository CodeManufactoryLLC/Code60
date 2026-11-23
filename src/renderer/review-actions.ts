import type {
  ApplicationClient,
  ProjectRequestIdentity,
  RelayReviewRequest,
  RelayReviewResponse,
} from "../bridge/index.js";

export type ReviewScope =
  | ({
      kind: "project";
      project: string;
      reviewId: string;
      chatId: string;
      live: boolean;
    } & ProjectRequestIdentity)
  | {
      kind: "relay";
      conversationId: string;
      generation: number;
      targetId: string;
      reviewId: string;
    };

export interface ReviewPreview {
  scope: ReviewScope;
  revisionId: string;
  title: string;
  related?: Omit<ReviewPreview, "related" | "application">[];
  application?: { operationId: string; fileId: string };
}

type Request = RelayReviewRequest extends infer R
  ? R extends RelayReviewRequest
    ? Omit<R, "conversationId" | "generation" | "targetId" | "reviewId">
    : never
  : never;

/** Presentation adapter only. Main remains responsible for ownership and confirmations. */
export async function reviewRequest(
  api: ApplicationClient,
  scope: ReviewScope,
  request: Request,
): Promise<RelayReviewResponse> {
  if (scope.kind === "relay") {
    const { kind: _kind, ...address } = scope;
    return api.relayReview({ ...address, ...request } as RelayReviewRequest);
  }
  const { project, projectId, databaseEpoch, reviewId } = scope;
  const address = { project, projectId, databaseEpoch, reviewId };
  if (request.type === "task")
    return { type: "task", task: await api.taskAction({ ...address, ...request.action }) };
  if (request.type === "cancel") {
    await api.cancelDiff({ requestId: request.requestId });
    return { type: "done" };
  }
  if (request.type === "capture")
    await api.captureReview({ ...address, requestId: request.requestId });
  else if (request.type === "action") await api.reviewAction({ ...address, ...request.action });
  else if (request.type !== "read") throw new Error("Unsupported conversation review request");
  const review = await api.readReview({
    ...address,
    requestId:
      request.type === "read" || request.type === "capture"
        ? request.requestId
        : crypto.randomUUID(),
    ...(request.type === "read" && request.revisionId ? { revisionId: request.revisionId } : {}),
  });
  return { type: "review", review, live: scope.live && review.chatId === scope.chatId };
}
