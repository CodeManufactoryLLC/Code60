import { StrictMode, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import {
  type DesktopApi,
  type DetailFrame,
  type DetailPayload,
  type DetailRequest,
  parseRelayFileContext,
  type RelayFileContext,
  type Snapshot,
} from "../../src/bridge/index.js";
import { useRelayFiles } from "../../src/renderer/relay-files.js";

const conversationId = "0805849b-dcb7-483c-87a6-d819a95b0011";
const targetId = "956232e0-1bcb-4a9e-9ca7-3b96884ec371";
const snapshot = {
  chats: [{ kind: "relay", conversationId, generation: 1 }],
  runs: [{ relay: { conversationId, generation: 1, targetId, cwd: "/target" } }],
} as unknown as Snapshot;
const listeners = new Set<(frame: DetailFrame) => void>();
const subscriptions = new Map<string, { request: DetailRequest; revision: number }>();
const contexts: RelayFileContext[] = [];
let hold = false;
let revision = 0;
let registrations = 0;
let releases = 0;
let errors = 0;
let lastReleased: DetailFrame | undefined;
const observers = new Set<() => void>();
const observe = (listener: () => void) => {
  observers.add(listener);
  return () => {
    observers.delete(listener);
  };
};
const changed = () => {
  for (const listener of observers) listener();
};
const transport = () =>
  JSON.stringify({
    registrations,
    releases,
    subscriptions: subscriptions.size,
    listeners: listeners.size,
    contexts: contexts.length,
    sequence: contexts.at(-1)?.sequence,
    errors,
  });
function payload(
  request: DetailRequest,
  context?: RelayFileContext,
  text = "initial",
): DetailPayload {
  const files = context
    ? {
        context,
        directories: [],
        preview: {
          path: context.preview ?? "note.txt",
          text,
          size: text.length,
          modifiedAt: null,
          error: null,
        },
      }
    : null;
  return request.scope.kind === "target"
    ? { kind: "target", targetId, cwd: "/target", runs: [], events: [], files }
    : {
        kind: "conversation",
        chat: {
          kind: "relay",
          conversationId,
          generation: 1,
          run: null,
          events: [],
          directory: "/workspace",
          error: null,
          updates: { paused: true, pending: 0 },
        },
        files,
      };
}
function publish(context: RelayFileContext, text = "fresh") {
  const owner = subscriptions.get(context.subscriptionId);
  if (!owner) return;
  const frame: DetailFrame = {
    ...owner.request,
    revision: ++revision,
    previousRevision: owner.revision,
    closed: false,
    payload: payload(owner.request, context, text),
  };
  owner.revision = revision;
  for (const receive of listeners) receive(frame);
}
const api = {
  onDetails(receive: (frame: DetailFrame) => void) {
    listeners.add(receive);
    changed();
    return () => {
      listeners.delete(receive);
      changed();
    };
  },
  async subscribeDetails(request: DetailRequest) {
    subscriptions.set(request.subscriptionId, { request, revision });
    registrations++;
    changed();
  },
  async unsubscribeDetails({ subscriptionId }: { subscriptionId: string }) {
    const owner = subscriptions.get(subscriptionId);
    if (!owner) {
      errors++;
      throw new Error("Duplicate release");
    }
    lastReleased = {
      ...owner.request,
      revision: ++revision,
      previousRevision: null,
      closed: false,
      payload: payload(owner.request),
    };
    subscriptions.delete(subscriptionId);
    releases++;
    changed();
  },
  async readDetails(request: DetailRequest): Promise<DetailFrame> {
    const owner = subscriptions.get(request.subscriptionId);
    if (!owner) {
      errors++;
      throw new Error("Obsolete read");
    }
    owner.revision = ++revision;
    return {
      ...request,
      revision,
      previousRevision: null,
      closed: false,
      payload: payload(request),
    };
  },
  async setRelayFileContext(value: RelayFileContext) {
    const context = parseRelayFileContext(value);
    if (!subscriptions.has(context.subscriptionId)) {
      errors++;
      throw new Error("Obsolete file context");
    }
    contexts.push(context);
    changed();
    if (!hold) publish(context);
  },
} as unknown as DesktopApi;
function Fixture() {
  const [enabled, setEnabled] = useState(true);
  const [active, setActive] = useState(true);
  const [root, setRoot] = useState("workspace");
  const [tick, setTick] = useState(0);
  const stats = useSyncExternalStore(observe, transport);
  const browser = useRelayFiles(api, snapshot, root, enabled, active, "note.txt", setRoot);
  return (
    <main>
      <button
        type="button"
        onClick={() => {
          hold = true;
          setTick(tick + 1);
        }}
      >
        Hold
      </button>
      <button type="button" onClick={() => setActive((value) => !value)}>
        Activate
      </button>
      <button type="button" onClick={() => setEnabled((value) => !value)}>
        Enable
      </button>
      <button type="button" onClick={() => setRoot(`target:${targetId}`)}>
        Target
      </button>
      <button
        type="button"
        onClick={() => {
          const context = contexts.at(-1);
          if (context) publish(context);
        }}
      >
        Publish latest
      </button>
      <button
        type="button"
        onClick={() => {
          const current = contexts.at(-1);
          const old = contexts.find(
            (context) => context.subscriptionId === current?.subscriptionId,
          );
          if (old) publish(old, "obsolete");
        }}
      >
        Publish stale
      </button>
      <button
        type="button"
        onClick={() => {
          if (lastReleased)
            for (const receive of listeners)
              receive({
                ...lastReleased,
                revision: ++revision,
              });
          setTick(tick + 1);
        }}
      >
        Publish released
      </button>
      <output aria-label="Preview">{browser.files?.preview?.text ?? ""}</output>
      <output aria-label="Error">{browser.error}</output>
      <output aria-label="Transport">
        {JSON.stringify({
          ...JSON.parse(stats),
          root,
          enabled,
          active,
          tick,
        })}
      </output>
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
