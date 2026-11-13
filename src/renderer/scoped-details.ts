import { useEffect, useMemo, useState } from "react";
import {
  type DesktopApi,
  type DesktopRun,
  type DetailFrame,
  type DetailScope,
  detailScopeKey,
  type OrchestrationChat,
} from "../bridge/index.js";
import { startDetailStream } from "./detail-stream.js";
import type { DesktopState } from "./snapshot-state.js";

function conversationScope(
  chat: OrchestrationChat,
  epoch: number | undefined,
): DetailScope | undefined {
  const id = chat.kind === "relay" ? chat.conversationId : chat.run?.id;
  if (!id || chat.generation === undefined) return;
  if (chat.kind === "relay")
    return { kind: "conversation", conversationId: id, generation: chat.generation };
  if (chat.projectId && epoch !== undefined)
    return {
      kind: "conversation",
      conversationId: id,
      generation: chat.generation,
      projectId: chat.projectId,
      databaseEpoch: epoch,
    };
}

function liveDetails(state: DesktopState | undefined): DetailScope[] {
  if (!state) return [];
  const { snapshot } = state;
  const epoch = snapshot.databaseEpoch;
  const relay = snapshot.chats.find((chat) => chat.kind === "relay");
  const targets = new Set<string>();
  return [
    ...(epoch === undefined
      ? []
      : (snapshot.openProjects ?? []).map(
          (project): DetailScope => ({
            kind: "project",
            projectId: project.id,
            databaseEpoch: epoch,
          }),
        )),
    ...[
      ...snapshot.chats.filter((chat) => chat.run?.id !== snapshot.chat.run?.id),
      snapshot.chat,
    ].flatMap((chat) => {
      const scope = conversationScope(chat, epoch);
      return scope ? [scope] : [];
    }),
    ...snapshot.runs.flatMap((run): DetailScope[] => {
      const target = run.relay;
      if (
        !target ||
        targets.has(target.targetId) ||
        target.conversationId !== relay?.conversationId ||
        target.generation !== relay?.generation
      )
        return [];
      targets.add(target.targetId);
      return [
        {
          kind: "target",
          targetId: target.targetId,
          conversationId: target.conversationId,
          generation: target.generation,
        },
      ];
    }),
  ];
}

export function requestedDetails(
  state: DesktopState | undefined,
  workerId?: string,
): DetailScope[] {
  const snapshot = state?.snapshot;
  if (!snapshot) return [];
  const scopes: DetailScope[] = [];
  if (snapshot.projectInstanceId && snapshot.databaseEpoch !== undefined)
    scopes.push({
      kind: "project",
      projectId: snapshot.projectInstanceId,
      databaseEpoch: snapshot.databaseEpoch,
    });
  const target = snapshot.runs.find((run) => run.record.id === workerId)?.relay;
  const targetScope =
    target &&
    liveDetails(state).find(
      (scope) => scope.kind === "target" && scope.targetId === target.targetId,
    );
  if (targetScope) scopes.push(targetScope);
  else {
    const conversation = conversationScope(snapshot.chat, snapshot.databaseEpoch);
    if (conversation) scopes.push(conversation);
  }
  return scopes;
}

function withRunDetails(summaries: DesktopRun[], details: DesktopRun[]): DesktopRun[] {
  const byId = new Map(details.map((run) => [run.record.id, run]));
  return summaries.map((run) => {
    const detail = byId.get(run.record.id);
    return detail
      ? { ...run, record: { ...run.record, firstPrompt: detail.record.firstPrompt } }
      : run;
  });
}

export function applyDetails(
  state: DesktopState | undefined,
  frames: Readonly<Record<string, DetailFrame>>,
): DesktopState | undefined {
  if (!state) return state;
  let next = state;
  for (const scope of liveDetails(state)) {
    const frame = frames[detailScopeKey(scope)];
    if (!frame || frame.closed) continue;
    const payload = frame.payload;
    if (payload.kind === "conversation" && scope.kind === "conversation") {
      const generation = scope.generation;
      const relay = payload.chat.kind === "relay";
      const matches = (chat: OrchestrationChat) =>
        chat.generation === generation &&
        (relay
          ? chat.kind === "relay" && chat.conversationId === scope.conversationId
          : chat.run?.id === scope.conversationId);
      const overlay = (chat: OrchestrationChat) =>
        matches(chat) &&
        payload.chat.history &&
        (state.snapshot.summaryOnly || frame.revision >= state.snapshot.revision || !chat.history)
          ? { ...chat, history: payload.chat.history }
          : chat;
      next = {
        ...next,
        snapshot: {
          ...next.snapshot,
          chat: overlay(next.snapshot.chat),
          chats: next.snapshot.chats.map(overlay),
        },
      };
      const id = payload.chat.run?.id;
      if (!id) continue;
      const events =
        frame.revision >= (state.chatEventRevisions?.[id] ?? -1)
          ? payload.chat.events.map((entry) => entry.event)
          : (state.chatEventsByRun[id] ?? []);
      next = {
        ...next,
        chatEventsByRun: { ...next.chatEventsByRun, [id]: events },
        chatEvents: next.snapshot.chat.run?.id === id ? events : next.chatEvents,
      };
    } else if (
      payload.kind === "project" &&
      frame.revision >= (state.projectViews?.[payload.projectId]?.revision ?? -1)
    ) {
      const own: DesktopState["events"] = {};
      for (const { event } of payload.events) {
        own[event.runId] ??= [];
        own[event.runId]?.push(event);
      }
      next = {
        ...next,
        ...(payload.projectId === state.snapshot.projectInstanceId &&
        (state.snapshot.summaryOnly || frame.revision >= state.snapshot.revision)
          ? {
              events: { ...next.events, ...own },
              snapshot: {
                ...next.snapshot,
                runs: state.snapshot.summaryOnly
                  ? withRunDetails(next.snapshot.runs, payload.runs)
                  : [...payload.runs, ...next.snapshot.runs.filter((run) => run.relay)],
                liveIds: state.snapshot.summaryOnly
                  ? next.snapshot.liveIds
                  : [
                      ...payload.liveIds,
                      ...next.snapshot.runs
                        .filter((run) => run.relay && next.snapshot.liveIds.includes(run.record.id))
                        .map((run) => run.record.id),
                    ],
                files: payload.files,
                worktrees: payload.worktrees,
                reviews: payload.reviews ?? [],
              },
            }
          : {}),
        projectViews: {
          ...next.projectViews,
          [payload.projectId]: {
            runs: state.snapshot.summaryOnly
              ? withRunDetails(
                  next.projectViews?.[payload.projectId]?.runs ?? payload.runs,
                  payload.runs,
                )
              : payload.runs,
            events: own,
            revision: frame.revision,
          },
        },
      };
    } else if (payload.kind === "target" && scope.kind === "target") {
      const ids = new Set(
        next.snapshot.runs
          .filter(
            (run) =>
              run.relay?.targetId === scope.targetId &&
              run.relay.conversationId === scope.conversationId &&
              run.relay.generation === scope.generation,
          )
          .map((run) => run.record.id),
      );
      const own: DesktopState["events"] = Object.fromEntries([...ids].map((id) => [id, []]));
      for (const { event } of payload.events)
        if (ids.has(event.runId)) own[event.runId]?.push(event);
      next = {
        ...next,
        events: { ...next.events, ...own },
        snapshot: {
          ...next.snapshot,
          runs: withRunDetails(next.snapshot.runs, payload.runs),
        },
      };
    }
  }
  return next;
}

/** Retain view data on navigation, but never retain a closed runtime's authority. */
export function useScopedDetails(
  api: DesktopApi,
  state: DesktopState | undefined,
  fail: (message: string) => void,
  workerId?: string,
) {
  const [frames, setFrames] = useState<Record<string, DetailFrame>>({});
  const scopes = JSON.stringify(requestedDetails(state, workerId));
  const live = JSON.stringify(liveDetails(state).map(detailScopeKey));
  // biome-ignore lint/correctness/useExhaustiveDependencies: Replacing the transport/error sink must dispose its registrations.
  const subscriptions = useMemo(() => new Map<string, () => void>(), [api, fail]);
  useEffect(() => {
    const keys = new Set<string>(JSON.parse(live));
    setFrames((frames) =>
      Object.fromEntries(Object.entries(frames).filter(([key]) => keys.has(key))),
    );
  }, [live]);
  useEffect(() => {
    // Legacy test/embed transports can still use the existing app stream.
    if (!api.onDetails || !api.subscribeDetails || !api.readDetails || !api.unsubscribeDetails)
      return;
    const requested = JSON.parse(scopes) as DetailScope[];
    const keys = new Set(requested.map(detailScopeKey));
    for (const [key, stop] of subscriptions) {
      if (keys.has(key)) continue;
      stop();
      subscriptions.delete(key);
    }
    for (const scope of requested) {
      const key = detailScopeKey(scope);
      if (subscriptions.has(key)) continue;
      subscriptions.set(
        key,
        startDetailStream(
          api,
          { scope, subscriptionId: crypto.randomUUID() },
          (frame) => setFrames((frames) => ({ ...frames, [key]: frame })),
          fail,
        ),
      );
    }
  }, [api, scopes, fail, subscriptions]);
  useEffect(
    () => () => {
      for (const stop of subscriptions.values()) stop();
      subscriptions.clear();
    },
    [subscriptions],
  );
  return useMemo(() => applyDetails(state, frames), [state, frames]);
}
