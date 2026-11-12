import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  type DesktopApi,
  type DetailFrame,
  type DetailRequest,
  type DetailScope,
  detailScopeKey,
  type Snapshot,
} from "../bridge/index.js";
import { startDetailStream } from "./detail-stream.js";
import { FileBrowserState } from "./file-browser-state.js";
import type { FileBrowser } from "./files.js";

export function relayFileRoots(snapshot: Snapshot | undefined) {
  const relay = snapshot?.chats.find((chat) => chat.kind === "relay");
  if (!relay?.conversationId || relay.generation === undefined) return [];
  const targets = new Map(
    snapshot?.runs.flatMap((run) =>
      run.relay &&
      run.relay.conversationId === relay.conversationId &&
      run.relay.generation === relay.generation
        ? [[run.relay.targetId, run.relay.cwd] as const]
        : [],
    ),
  );
  return [
    { path: "workspace", label: "Relay workspace" },
    ...[...targets].map(([id, cwd]) => ({ path: `target:${id}`, label: `Target · ${cwd}` })),
  ];
}

export function relayFileScope(
  snapshot: Snapshot | undefined,
  root: string,
): DetailScope | undefined {
  const relay = snapshot?.chats.find((chat) => chat.kind === "relay");
  if (!relay?.conversationId || relay.generation === undefined) return;
  if (root === "workspace")
    return {
      kind: "conversation",
      conversationId: relay.conversationId,
      generation: relay.generation,
    };
  if (!relayFileRoots(snapshot).some((choice) => choice.path === root)) return;
  return {
    kind: "target",
    targetId: root.slice("target:".length),
    conversationId: relay.conversationId,
    generation: relay.generation,
  };
}

/** Opening Files explicitly chooses a Relay root; project navigation never supplies it. */
export function useRelayFiles(
  api: DesktopApi,
  snapshot: Snapshot | undefined,
  root: string,
  enabled: boolean,
  active: boolean,
  preview: string | null,
  setRoot: (root: string) => void,
): FileBrowser {
  const scope = relayFileScope(snapshot, root);
  const key = scope ? detailScopeKey(scope) : `unavailable:${root}`;
  const owner = useMemo(() => new FileBrowserState(key), [key]);
  const registration = useMemo(() => ({ api, key, enabled }), [api, key, enabled]);
  useLayoutEffect(() => {
    owner.activate();
    return () => owner.dispose();
  }, [owner]);
  const state = useSyncExternalStore(owner.subscribe, owner.snapshot, owner.snapshot);
  const [connection, setConnection] = useState<{
    registration: typeof registration;
    request: DetailRequest;
    frame: DetailFrame;
  }>();
  const sequence = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: key canonically includes the complete scope; snapshot/selection changes never replace an unchanged root.
  useEffect(() => {
    if (!enabled || !scope || !api.setRelayFileContext || !api.subscribeDetails) return;
    setConnection(undefined);
    const request = { scope, subscriptionId: crypto.randomUUID() };
    let alive = true;
    const stop = startDetailStream(
      api,
      request,
      (frame) => {
        if (alive) setConnection({ registration, request, frame });
      },
      (message) => {
        if (alive) owner.setError(message);
      },
    );
    return () => {
      alive = false;
      stop();
    };
  }, [api, key, enabled, owner, registration]);
  const current = enabled && connection?.registration === registration ? connection : undefined;
  const requestId = current?.frame.closed === false ? current.request.subscriptionId : undefined;
  const directories =
    preview !== null
      ? [""]
      : [
          "",
          ...state.expanded.filter((path) =>
            path
              .split("/")
              .slice(0, -1)
              .every((_, index) =>
                state.expanded.includes(
                  path
                    .split("/")
                    .slice(0, index + 1)
                    .join("/"),
                ),
              ),
          ),
        ];
  const requestJson = JSON.stringify({ active, directories, preview });
  useEffect(() => {
    if (!requestId) return;
    let alive = true;
    owner.setError("");
    void api
      .setRelayFileContext({
        subscriptionId: requestId,
        sequence: ++sequence.current,
        ...(JSON.parse(requestJson) as {
          active: boolean;
          directories: string[];
          preview: string | null;
        }),
      })
      .catch((cause: unknown) => {
        if (alive) owner.setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      alive = false;
    };
  }, [api, requestId, requestJson, owner]);
  const payload =
    current && !current.frame.closed && current.frame.payload.kind !== "project"
      ? current.frame.payload
      : undefined;
  const files =
    payload?.files && payload.files.context.subscriptionId === requestId ? payload.files : null;
  const matching =
    files &&
    files.context.sequence === sequence.current &&
    JSON.stringify({
      active: files.context.active,
      directories: files.context.directories,
      preview: files.context.preview,
    }) === requestJson;
  const polling = payload?.filePolling;
  return {
    root,
    preview,
    selectedFile: state.selected,
    expanded: state.expanded,
    setExpanded: owner.setExpanded,
    files: active && matching ? files : null,
    directories: files?.directories ?? [],
    roots: relayFileRoots(snapshot),
    setRoot,
    selectFile: owner.selectFile,
    error:
      state.error ||
      polling?.lastError ||
      (enabled && !scope ? "This Relay file root is no longer available." : ""),
    loading: !!scope && active && (!matching || polling?.status === "polling"),
    workspace: key,
  };
}
