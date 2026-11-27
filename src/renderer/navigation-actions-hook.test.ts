import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ApplicationClient, OrchestrationChat } from "../bridge/index.js";
import { useNavigationActions as renderNavigation } from "./navigation-actions.js";
import { initialTabs } from "./tabs.js";

type Slot = {
  value?: unknown;
  dependencies?: readonly unknown[];
  cleanup?: (() => void) | undefined;
};
const hooks = vi.hoisted(() => ({
  slots: [] as Slot[],
  index: 0,
  dirty: false,
  effects: [] as (() => void)[],
}));
const next = () => {
  const index = hooks.index++;
  hooks.slots[index] ??= {};
  return hooks.slots[index];
};
// Supporting hook checks hold the app stream behind IPC without a timing-dependent sleep.
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const slot = next();
    if (!Object.hasOwn(slot, "value"))
      slot.value = typeof initial === "function" ? initial() : initial;
    return [
      slot.value,
      (update: unknown) => {
        const value = typeof update === "function" ? update(slot.value) : update;
        if (!Object.is(value, slot.value)) {
          slot.value = value;
          hooks.dirty = true;
        }
      },
    ];
  },
  useRef: (initial: unknown) => {
    const slot = next();
    slot.value ??= { current: initial };
    return slot.value;
  },
  useEffect: (effect: () => (() => void) | undefined, dependencies: readonly unknown[]) => {
    const slot = next();
    if (
      !slot.dependencies ||
      dependencies.some((value, index) => !Object.is(value, slot.dependencies?.[index]))
    )
      hooks.effects.push(() => {
        slot.cleanup?.();
        slot.cleanup = effect();
      });
    slot.dependencies = dependencies;
  },
}));
beforeEach(() => {
  hooks.slots = [];
});
afterEach(() => {
  for (const slot of hooks.slots) slot.cleanup?.();
});

function fixture() {
  const chat = (id: string, customAgentId?: string) =>
    ({
      kind: "relay",
      conversationId: `${id}-conversation`,
      run: { id },
      ...(customAgentId ? { customAgentId } : {}),
    }) as OrchestrationChat;
  const relay = chat("relay");
  const reviewer = chat("reviewer", "reviewer-definition");
  const writer = chat("writer", "writer-definition");
  const customAgent = vi.fn(async () => ({}));
  const context: Parameters<typeof renderNavigation>[0] = {
    api: {
      customAgent,
      orchestrationChatAction: vi.fn(async () => undefined),
    } as unknown as ApplicationClient,
    tabs: initialTabs,
    database: null,
    databaseEpoch: 1,
    projects: [],
    chats: [relay],
    runs: [],
    selectedId: "relay",
    onPage: vi.fn(),
    onSection: vi.fn(),
    selectWorker: vi.fn(),
    onArchived: vi.fn(),
  };
  const render = () => {
    for (let pass = 0; pass < 10; pass++) {
      hooks.index = 0;
      hooks.dirty = false;
      hooks.effects = [];
      const result = renderNavigation(context);
      for (const effect of hooks.effects) effect();
      if (!hooks.dirty) return result;
    }
    throw new Error("Navigation selection did not settle");
  };
  return { context, customAgent, reviewer, writer, render };
}

it("keeps the previous composer inactive until the opened custom owner is selected", async () => {
  const { context, reviewer, render } = fixture();
  const actions = render();
  expect(actions.conversationPending).toBe(false);
  expect(await actions.open({ kind: "custom-agent", id: "reviewer-definition" })).toBe(true);
  expect(render().conversationPending).toBe(true);
  // Loading an owner's summary is not confirmation that selection has changed.
  context.chats = [...context.chats, reviewer];
  expect(render().conversationPending).toBe(true);
  context.selectedId = "reviewer";
  expect(render().conversationPending).toBe(false);
  // Later host-driven selection changes (for example archive) must not stay gated.
  context.selectedId = "relay";
  expect(render().conversationPending).toBe(false);
});

it("replaces an unacknowledged destination and waits for the latest conversation", async () => {
  const { context, reviewer, writer, render } = fixture();
  context.chats = [...context.chats, reviewer, writer];
  await render().open({ kind: "custom-agent", id: "writer-definition" });
  expect(render().conversationPending).toBe(true);
  await render().open({ kind: "conversation", id: "reviewer" });
  context.selectedId = "writer";
  expect(render().conversationPending).toBe(true);
  context.selectedId = "reviewer";
  expect(render().conversationPending).toBe(false);
  await render().open({ kind: "conversation", id: "writer" });
  expect(render().conversationPending).toBe(true);
  context.selectedId = "writer";
  expect(render().conversationPending).toBe(false);
});

it("does not hide the current conversation after a failed open", async () => {
  const { customAgent, render } = fixture();
  customAgent.mockRejectedValueOnce(new Error("Unavailable"));
  expect(await render().open({ kind: "custom-agent", id: "missing" })).toBe(false);
  expect(render().conversationPending).toBe(false);
  expect(render().error).toBe("Unavailable");
});

it("reports a non-blocking selection as busy until its request settles", async () => {
  const { context, reviewer, render } = fixture();
  context.chats = [...context.chats, reviewer];
  let finish!: () => void;
  vi.mocked(context.api.orchestrationChatAction).mockImplementationOnce(
    () => new Promise<undefined>((resolve) => (finish = () => resolve(undefined))),
  );
  const selection = render().open({ kind: "conversation", id: "reviewer" });
  // Selection leaves controls enabled, but another navigation is ignored until it settles.
  expect(render()).toMatchObject({ pending: false, busy: true });
  expect(await render().open({ kind: "conversation", id: "relay" })).toBe(false);
  finish();
  expect(await selection).toBe(true);
  expect(render().busy).toBe(false);
});
