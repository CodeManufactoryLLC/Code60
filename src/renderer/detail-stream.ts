import {
  type DesktopApi,
  type DetailFrame,
  type DetailPayload,
  type DetailRequest,
  detailScopeKey,
  type SequencedEvent,
} from "../bridge/index.js";
import { startSnapshotStream } from "./snapshot-stream.js";

function mergeEvents(
  previous: SequencedEvent[],
  next: SequencedEvent[],
  after: number,
): SequencedEvent[] {
  return [...previous, ...next.filter((entry) => entry.revision > after)];
}
export function mergeDetailFrame(
  previous: DetailFrame | undefined,
  frame: DetailFrame,
): DetailFrame {
  if (previous && frame.revision <= previous.revision) return previous;
  if (frame.closed || !previous || previous.closed || frame.previousRevision === null) return frame;
  const before = previous.payload;
  const next = frame.payload;
  let payload: DetailPayload = next;
  if (before.kind === "conversation" && next.kind === "conversation" && next.chat.kind !== "relay")
    payload = {
      ...next,
      chat: {
        ...next.chat,
        events: mergeEvents(before.chat.events, next.chat.events, previous.revision),
      },
    };
  if (before.kind === "project" && next.kind === "project")
    payload = { ...next, events: mergeEvents(before.events, next.events, previous.revision) };
  return { ...frame, payload };
}

/** Each view subscribes before reading and owns an independent revision sequence. */
export function startDetailStream(
  api: Pick<DesktopApi, "onDetails" | "subscribeDetails" | "readDetails" | "unsubscribeDetails"> &
    Partial<Pick<DesktopApi, "subscribe">>,
  request: DetailRequest,
  publish: (frame: DetailFrame) => void,
  fail: (message: string) => void,
): () => void {
  let current: DetailFrame | undefined;
  let connected: Promise<void> | undefined;
  let active = true;
  let terminal: DetailFrame | undefined;
  let desiredRevision = 0;
  const key = detailScopeKey(request.scope);
  const matches = (frame: DetailFrame) =>
    frame.subscriptionId === request.subscriptionId && detailScopeKey(frame.scope) === key;
  return startSnapshotStream({
    stale: (frame) => !frame.closed && frame.revision < desiredRevision,
    ...(api.subscribe
      ? {
          resynchronize: (refresh: () => void) =>
            api.subscribe?.((summary) => {
              const revision = summary.detailRevisions?.[request.subscriptionId];
              if (revision === undefined || revision <= desiredRevision) return;
              desiredRevision = revision;
              if (!current || revision > current.revision) refresh();
            }) ?? (() => {}),
        }
      : {}),
    subscribe: (receive) => {
      const off = api.onDetails((frame) => {
        if (!matches(frame)) return;
        if (frame.closed) terminal = frame;
        receive(frame);
      });
      return () => {
        active = false;
        off();
        void connected
          ?.then(() => api.unsubscribeDetails({ subscriptionId: request.subscriptionId }))
          .catch(() => {});
      };
    },
    read: async () => {
      connected ??= api.subscribeDetails(request);
      try {
        await connected;
        if (!active) throw new Error("This detail view was disposed");
        const frame = await api.readDetails(request);
        if (!matches(frame)) throw new Error("The detail response addressed another owner");
        return frame;
      } catch (cause) {
        if (terminal) return terminal;
        throw cause;
      }
    },
    current: () => current,
    merge: mergeDetailFrame,
    hasGap: (previous, frame) =>
      !frame.closed &&
      frame.revision > previous.revision &&
      frame.previousRevision !== null &&
      frame.previousRevision > previous.revision,
    publish: (frame) => {
      if (frame === current) return;
      current = frame;
      publish(frame);
    },
    fail,
  });
}
