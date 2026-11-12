import { describe, expect, it, vi } from "vitest";
import type {
  DesktopApi,
  DetailFrame,
  DetailRequest,
  OrchestrationChat,
  Snapshot,
} from "../bridge/index.js";
import { mergeDetailFrame, startDetailStream } from "./detail-stream.js";

const request: DetailRequest = {
  subscriptionId: "a0f72328-e920-4834-ae1d-8ee279826068",
  scope: {
    kind: "conversation",
    conversationId: "chat",
    generation: 1,
    projectId: "4975473d-74a9-48d7-902e-fc79d975cbd3",
    databaseEpoch: 1,
  },
};
const events = (revisions: number[]) =>
  revisions.map((revision) => ({
    revision,
    event: { type: "message" as const, runId: "chat", at: "", text: String(revision) },
  }));
function frame(
  revision: number,
  previousRevision: number | null = null,
  revisions = [revision],
): DetailFrame {
  return {
    ...request,
    revision,
    previousRevision,
    closed: false,
    payload: {
      kind: "conversation",
      chat: { kind: "project", events: events(revisions) } as OrchestrationChat,
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function source(hints = false) {
  const connected = deferred<void>();
  const initial = deferred<DetailFrame>();
  let receive!: (frame: DetailFrame) => void;
  let summary!: (snapshot: Snapshot) => void;
  const order: string[] = [];
  const off = vi.fn();
  const offSummary = vi.fn();
  const read = vi.fn(() => initial.promise);
  const unsubscribe = vi.fn(async () => {});
  const api: Pick<
    DesktopApi,
    "onDetails" | "subscribeDetails" | "readDetails" | "unsubscribeDetails"
  > &
    Partial<Pick<DesktopApi, "subscribe">> = {
    ...(hints
      ? {
          subscribe: (listener: (snapshot: Snapshot) => void) => {
            summary = listener;
            return offSummary;
          },
        }
      : {}),
    onDetails: (listener) => {
      order.push("listen");
      receive = listener;
      return off;
    },
    subscribeDetails: () => {
      order.push("subscribe");
      return connected.promise;
    },
    readDetails: read,
    unsubscribeDetails: unsubscribe,
  };
  const published: DetailFrame[] = [];
  const fail = vi.fn();
  const stop = startDetailStream(api, request, (frame) => published.push(frame), fail);
  const ready = async (value = frame(1)) => {
    connected.resolve();
    initial.resolve(value);
    await vi.waitFor(() => expect(published.length).toBeGreaterThan(0));
  };
  return {
    api,
    connected,
    initial,
    read,
    order,
    off,
    offSummary,
    unsubscribe,
    fail,
    published,
    stop,
    ready,
    push: (frame: DetailFrame) => receive(frame),
    hint: (detailRevisions: Record<string, number>) => summary({ detailRevisions } as Snapshot),
  };
}
const revisions = (frame: DetailFrame | undefined) =>
  frame && !frame.closed && frame.payload.kind === "conversation"
    ? frame.payload.chat.events.map((entry) => entry.revision)
    : [];

describe("owner-scoped detail stream", () => {
  it("recovers a dropped final frame from its own summary hint with a single flight", async () => {
    const s = source(true);
    await s.ready();
    s.hint({ another: 100 });
    s.hint({ [request.subscriptionId]: 1 });
    expect(s.read).toHaveBeenCalledOnce();
    const full = deferred<DetailFrame>();
    s.read.mockReturnValue(full.promise);
    s.hint({ [request.subscriptionId]: 5 });
    s.hint({ [request.subscriptionId]: 5 });
    s.hint({ [request.subscriptionId]: 6 });
    await vi.waitFor(() => expect(s.read).toHaveBeenCalledTimes(2));
    full.resolve(frame(6, null, [1, 3, 6]));
    await vi.waitFor(() => expect(revisions(s.published.at(-1))).toEqual([1, 3, 6]));
    s.hint({ [request.subscriptionId]: 6 });
    expect(s.read).toHaveBeenCalledTimes(2);
    s.stop();
    expect(s.offSummary).toHaveBeenCalledOnce();
    s.hint({ [request.subscriptionId]: 7 });
    expect(s.read).toHaveBeenCalledTimes(2);
  });

  it("checks hints received during the initial read before installing stale details", async () => {
    const s = source(true);
    s.read.mockReturnValueOnce(s.initial.promise).mockResolvedValueOnce(frame(5, null, [1, 5]));
    s.connected.resolve();
    await vi.waitFor(() => expect(s.read).toHaveBeenCalledOnce());
    s.hint({ [request.subscriptionId]: 5 });
    s.initial.resolve(frame(1));
    await vi.waitFor(() => expect(revisions(s.published.at(-1))).toEqual([1, 5]));
    expect(s.published).toHaveLength(1);
    expect(s.read).toHaveBeenCalledTimes(2);
    expect(s.fail).not.toHaveBeenCalled();
    s.stop();
  });

  it("bounds stale hint recovery to three attempts and releases both listeners", async () => {
    const s = source(true);
    await s.ready();
    s.read.mockResolvedValue(frame(1));
    s.hint({ [request.subscriptionId]: 5 });
    await vi.waitFor(() => expect(s.fail).toHaveBeenCalledWith(expect.stringContaining("Reload")));
    expect(s.read).toHaveBeenCalledTimes(4);
    expect(s.off).toHaveBeenCalledOnce();
    expect(s.offSummary).toHaveBeenCalledOnce();
    expect(s.published).toHaveLength(1);
    s.stop();
    expect(s.offSummary).toHaveBeenCalledOnce();
  });

  it("listens before registration and full read, buffers deltas and ignores other owners", async () => {
    const s = source();
    expect(s.order).toEqual(["listen", "subscribe"]);
    expect(s.read).not.toHaveBeenCalled();
    s.push({ ...frame(100, 1), subscriptionId: "another" });
    s.push({ ...frame(101, 1), scope: { ...request.scope, generation: 2 } } as DetailFrame);
    s.push(frame(2, 1));
    await s.ready();
    expect(revisions(s.published.at(-1))).toEqual([1, 2]);
    s.push(frame(2, 1));
    expect(s.published).toHaveLength(1);
    s.stop();
    await vi.waitFor(() =>
      expect(s.unsubscribe).toHaveBeenCalledExactlyOnceWith({
        subscriptionId: request.subscriptionId,
      }),
    );
    expect(s.off).toHaveBeenCalledTimes(1);
  });

  it("recovers missing detail frames independently with one full read", async () => {
    const s = source();
    await s.ready();
    const full = deferred<DetailFrame>();
    s.read.mockReturnValue(full.promise);
    s.push(frame(5, 4));
    s.push(frame(6, 5));
    await vi.waitFor(() => expect(s.read).toHaveBeenCalledTimes(2));
    full.resolve(frame(5, null, [1, 3, 5]));
    await vi.waitFor(() => expect(revisions(s.published.at(-1))).toEqual([1, 3, 5, 6]));
    expect(s.fail).not.toHaveBeenCalled();
    s.stop();
  });

  it("resynchronizes overflow and stops after three failed bounded attempts", async () => {
    const s = source();
    const second = deferred<DetailFrame>();
    const third = deferred<DetailFrame>();
    const reads = [s.initial, second, third];
    s.read
      .mockImplementationOnce(() => s.initial.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);
    s.connected.resolve();
    for (let attempt = 0; attempt < 3; attempt++) {
      await vi.waitFor(() => expect(s.read).toHaveBeenCalledTimes(attempt + 1));
      for (let revision = 2; revision <= 1002; revision++) s.push(frame(revision, revision - 1));
      reads[attempt]?.resolve(frame(1));
    }
    await vi.waitFor(() => expect(s.fail).toHaveBeenCalledWith(expect.stringContaining("Reload")));
    expect(s.published).toEqual([]);
    expect(s.read).toHaveBeenCalledTimes(3);
    expect(s.off).toHaveBeenCalledTimes(1);
    s.stop();
  });

  it("unregisters a late registration after disposal without reading or publishing", async () => {
    const s = source();
    s.stop();
    s.stop();
    s.push(frame(4));
    s.connected.resolve();
    await vi.waitFor(() => expect(s.unsubscribe).toHaveBeenCalledTimes(1));
    expect(s.read).not.toHaveBeenCalled();
    expect(s.published).toEqual([]);
    expect(s.fail).not.toHaveBeenCalled();
  });

  it("publishes an owner's terminal frame even when its in-flight read rejects", async () => {
    const s = source();
    s.connected.resolve();
    await vi.waitFor(() => expect(s.read).toHaveBeenCalled());
    s.push({ ...request, revision: 4, previousRevision: 1, closed: true });
    s.initial.reject(new Error("closed"));
    await vi.waitFor(() => expect(s.published.at(-1)).toMatchObject({ closed: true, revision: 4 }));
    expect(s.fail).not.toHaveBeenCalled();
    s.stop();
  });

  it("replaces bounded Relay/target windows and full reads instead of accumulating them", () => {
    const a = frame(1);
    const b = frame(2, 1);
    if (b.closed || b.payload.kind !== "conversation") throw new Error("fixture");
    b.payload.chat.kind = "relay";
    expect(revisions(mergeDetailFrame(a, b))).toEqual([2]);
    expect(revisions(mergeDetailFrame(a, frame(3, null)))).toEqual([3]);
    const target = {
      ...b,
      payload: {
        kind: "target" as const,
        targetId: "target",
        cwd: "/a",
        runs: [],
        events: events([2]),
      },
    };
    expect(mergeDetailFrame(a, target)).toEqual(target);
  });
});
