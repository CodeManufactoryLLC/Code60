import {
  type ComponentProps,
  type DependencyList,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopRun, OrchestrationChat } from "../bridge/index.js";
import { AgentLogo } from "./agent-logo.js";
import { ChatSidebar } from "./chat-sidebar.js";
import { PageTabBar } from "./page-tabs.js";
import { ProjectChatSidebar } from "./project-chat-sidebar.js";
import { initialTabs } from "./tabs.js";

type Slot = { value?: unknown; dependencies?: DependencyList | undefined };
type Hooks = { slots: Slot[]; index: number; dirty: boolean; effects: (() => unknown)[] };
const current = vi.hoisted(() => ({ hooks: undefined as Hooks | undefined }));
const next = () => {
  const hooks = current.hooks;
  if (!hooks) throw new Error("Missing hook scope");
  const index = hooks.index++;
  hooks.slots[index] ??= {};
  return { hooks, slot: hooks.slots[index] };
};
const changed = (before: DependencyList | undefined, after: DependencyList | undefined) =>
  !before ||
  !after ||
  before.length !== after.length ||
  after.some((value, index) => !Object.is(value, before[index]));

// Supporting lifecycle tests only. Real DOM, CSS and IPC are covered by the desktop journey.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const { hooks, slot } = next();
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
  useRef: (value: unknown) => {
    const { slot } = next();
    slot.value ??= { current: value };
    return slot.value;
  },
  useMemo: (compute: () => unknown, dependencies: DependencyList) => {
    const { slot } = next();
    if (changed(slot.dependencies, dependencies)) slot.value = compute();
    slot.dependencies = dependencies;
    return slot.value;
  },
  useLayoutEffect: (effect: () => unknown, dependencies?: DependencyList) => {
    const { hooks, slot } = next();
    if (changed(slot.dependencies, dependencies)) hooks.effects.push(effect);
    slot.dependencies = dependencies;
  },
  useEffect: () => {},
}));

function mount<Props>(component: (props: Props) => ReactNode, initial: Props) {
  const hooks: Hooks = { slots: [], index: 0, dirty: false, effects: [] };
  let props = initial;
  let tree: ReactNode;
  const render = (update: Partial<Props> = {}) => {
    props = { ...props, ...update };
    for (let pass = 0; pass < 20; pass++) {
      hooks.index = 0;
      hooks.dirty = false;
      hooks.effects = [];
      current.hooks = hooks;
      tree = component(props);
      for (const effect of hooks.effects) effect();
      if (!hooks.dirty) return tree;
    }
    throw new Error("Unsettled disclosure effects");
  };
  render();
  return { render, tree: () => tree };
}

type Element = ReactElement<Record<string, unknown>>;
function find(tree: ReactNode, match: (element: Element) => boolean): Element {
  function visit(node: ReactNode): Element | undefined {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = visit(child);
        if (found) return found;
      }
    }
    if (!isValidElement<Record<string, unknown>>(node)) return;
    if (match(node)) return node;
    return visit(node.props.children as ReactNode);
  }
  const result = visit(tree);
  if (!result) throw new Error("Missing navigation element");
  return result;
}
const byId = (tree: ReactNode, id: string) => find(tree, (element) => element.props.id === id);
function press(tree: ReactNode, id: string, key: string) {
  const onKeyDown = byId(tree, id).props.onKeyDown as (event: unknown) => void;
  onKeyDown({ key, preventDefault: vi.fn(), stopPropagation: vi.fn() });
}
function click(tree: ReactNode, id: string) {
  (byId(tree, id).props.onClick as () => void)();
}

const project = { id: "a", path: "/a", active: false, chatIds: ["chat"], workerIds: ["worker"] };
const chats = [
  { kind: "relay", conversationId: "relay", workers: [] },
  {
    kind: "project",
    projectId: "a",
    run: { id: "chat", agent: "claude", status: "idle", turns: 0, pending: [] },
    workers: ["worker"],
  },
] as unknown as OrchestrationChat[];
const runs = [{ record: { id: "worker", agent: "fake", status: "idle" } }] as DesktopRun[];
const chatProps: ComponentProps<typeof ChatSidebar> = {
  chats,
  runs,
  selectedId: "chat",
  navigationSerial: undefined,
  database: "/db",
  eventsByRun: {},
  open: true,
  pending: false,
  onSelect: vi.fn(),
};
beforeEach(() => {
  vi.stubGlobal("localStorage", { getItem: () => "true", setItem: vi.fn() });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal("document", { getElementById: () => null, querySelector: () => null });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  current.hooks = undefined;
  vi.unstubAllGlobals();
});

function tabList(overrides: Partial<ComponentProps<typeof PageTabBar>> = {}) {
  const props: ComponentProps<typeof PageTabBar> = {
    showRelayDot: false,
    onShowRelayDotChange: vi.fn(),
    theme: "system",
    onThemeChange: vi.fn(),
    ...chatProps,
    tabs: { ...initialTabs, active: "settings" },
    settingsSection: null,
    onSelect: vi.fn(),
    onSettingsSectionSelect: vi.fn(),
    onOpenProject: vi.fn(),
    projectDisabled: false,
    openProjects: [project],
    navigation: {
      open: vi.fn(async () => true),
      chatAction: vi.fn(async () => true),
      projectAction: vi.fn(async () => true),
      invalidate: vi.fn(),
      pending: false,
      busy: false,
      projectPending: false,
      conversationPending: false,
      error: "",
    },
    ...overrides,
  };
  const shell = mount(PageTabBar, props);
  const list = find(
    shell.tree(),
    (element) => typeof element.type === "function" && element.type.name === "PageTabList",
  );
  return mount(list.type as (value: typeof props) => ReactNode, list.props as typeof props);
}

it("opens Projects and preserves its conversations across navigation", () => {
  const onSelect = vi.fn();
  const view = tabList({ onSelect });
  click(view.tree(), "tab-chat");
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("projects");
  expect(byId(view.tree(), "chat-pages").props.hidden).toBeFalsy();
});

it("retains custom assistant disclosure and reveals its rows when opened", () => {
  vi.stubGlobal("localStorage", { getItem: () => "false", setItem: vi.fn() });
  const onSelect = vi.fn();
  const view = tabList({ onSelect });
  expect(byId(view.tree(), "custom-agent-pages").props.inert).toBe(true);
  click(view.tree(), "tab-custom-agents");
  view.render({ tabs: { ...initialTabs, active: "custom-agents" } });
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("custom-agents");
  expect(byId(view.tree(), "custom-agent-pages").props.inert).toBe(false);
  press(view.tree(), "tab-custom-agents", "ArrowLeft");
  view.render();
  expect(byId(view.tree(), "custom-agent-pages").props.hidden).toBe(true);
});

it("keeps an unidentified failed custom assistant reachable through its definition entry", () => {
  const view = tabList({
    customAgents: [{ id: "unavailable", name: "Recovery Agent", revision: 1, archived: false }],
    chats: [
      ...chats,
      {
        kind: "relay",
        customAgentId: "unavailable",
        run: null,
        directory: null,
        error: "Storage is unavailable",
      } as OrchestrationChat,
    ],
  });
  const entry = find(
    view.tree(),
    (element) =>
      typeof element.props.onClick === "function" &&
      element.props.className === "chat-sidebar-entry",
  );
  expect(
    find(
      entry.props.children as ReactNode,
      (element) => element.props.className === "chat-sidebar-label",
    ).props.children,
  ).toBe("Recovery Agent");
  expect(entry.props.disabled).toBe(false);
  expect(entry.props.onClick).toBeTypeOf("function");
});

it.each([
  ["finished", "Finished"],
  ["interrupted", "Interrupted"],
] as const)(
  "hides worker unread counts and visible %s labels while preserving accessible status",
  (status, label) => {
    const view = mount(ChatSidebar, {
      ...chatProps,
      runs: runs.map((worker) => ({
        ...worker,
        record: { ...worker.record, status },
      })),
      eventsByRun: {
        worker: [
          { runId: "worker", at: "2026-01-01", type: "prompt", turn: 1, text: "Task" },
          { runId: "worker", at: "2026-01-01", type: "message", text: "Reply" },
        ],
      },
    });
    const row = byId(view.tree(), "conversation-worker");
    expect(row.props["aria-description"]).toContain(label);
    expect(find(row, (element) => element.props.className === "sr-only").props.children).toContain(
      label,
    );
    expect(() => find(row, (element) => element.props.className === "chat-unread")).toThrow(
      "Missing navigation element",
    );
    expect(() =>
      find(view.tree(), (element) => element.props.className === "chat-sidebar-status"),
    ).toThrow("Missing navigation element");
  },
);

it.each(["project", "relay", "manual"] as const)(
  "keeps %s worker counts hidden across pushed replies and navigation",
  (kind) => {
    const owner = {
      ...chats[1],
      kind: kind === "relay" ? "relay" : "project",
    } as OrchestrationChat;
    if (kind === "manual") owner.workers = [];
    const view = mount(ChatSidebar, { ...chatProps, chats: [owner] });
    for (const count of [1, 3]) {
      // Exercise both legacy transcript updates and compact app-summary updates.
      for (const compact of [false, true]) {
        view.render({
          runs: runs.map((worker) => ({
            ...worker,
            ...(compact ? { replies: { count, lastTurn: count } } : {}),
          })),
          eventsByRun: {
            worker: Array.from({ length: count }, (_, index) => [
              {
                runId: "worker",
                at: "2026-01-01",
                type: "prompt" as const,
                turn: index + 1,
                text: "Task",
              },
              { runId: "worker", at: "2026-01-01", type: "message" as const, text: "Reply" },
            ]).flat(),
          },
        });
        const row = byId(view.tree(), "conversation-worker");
        expect(row.props["aria-description"]).toContain("Worker. Ready");
        expect(row.props["aria-description"]).not.toContain("unread");
        expect(() => find(row, (element) => element.props.className === "chat-unread")).toThrow(
          "Missing navigation element",
        );
        view.render({ selectedId: "worker" });
        view.render({ selectedId: "chat" });
        expect(() =>
          find(
            byId(view.tree(), "conversation-worker"),
            (element) => element.props.className === "chat-unread",
          ),
        ).toThrow("Missing navigation element");
      }
    }
  },
);

it("keeps approval counts without a visible sidebar status label", () => {
  const view = mount(ChatSidebar, {
    ...chatProps,
    chats: chats.map((chat) =>
      chat.run
        ? ({
            ...chat,
            run: {
              ...chat.run,
              pending: [
                {
                  id: "permission",
                  runId: chat.run.id,
                  toolCallId: "tool",
                  kind: "execute",
                  title: "Run command",
                },
              ],
            },
          } as OrchestrationChat)
        : chat,
    ),
  });
  const row = byId(view.tree(), "conversation-chat");
  expect(
    find(row, (element) => element.props.className === "chat-approval-count").props.children,
  ).toEqual(["(", 1, ")"]);
  expect(row.props["aria-description"]).toContain("1 approvals waiting");
  expect(() =>
    find(view.tree(), (element) => element.props.className === "chat-sidebar-status"),
  ).toThrow("Missing navigation element");
});

it("keeps project worker disclosure independent from chat selection on the leading icon", () => {
  const onSelect = vi.fn();
  const view = mount(ChatSidebar, { ...chatProps, onSelect });
  const toggle = () =>
    find(view.tree(), (element) => element.props["aria-controls"] === "workers-chat");
  expect(toggle().props.className).toContain("chat-workers-toggle-leading");
  expect(find(toggle(), (element) => element.type === AgentLogo).props.id).toBe("claude");
  (toggle().props.onClick as () => void)();
  view.render();
  expect(toggle().props["aria-expanded"]).toBe(false);
  expect(byId(view.tree(), "workers-chat").props.hidden).toBe(true);
  expect(onSelect).not.toHaveBeenCalled();
  click(view.tree(), "conversation-chat");
  expect(onSelect).toHaveBeenCalledWith("chat");
  view.render({ pending: true });
  expect(toggle().props.disabled).toBe(true);
});

it("reveals Develop for project conversations and Chat for Relay", () => {
  const view = tabList({ tabs: { ...initialTabs, active: "chat" } });
  const group = (title: string) => find(view.tree(), (element) => element.props.title === title);
  expect(group("Develop").props.destination).toBeDefined();
  expect(group("Chat").props.destination).toBeUndefined();
  view.render({ selectedId: "relay" });
  expect(group("Develop").props.destination).toBeUndefined();
  expect(group("Chat").props.destination).toBeDefined();
});

it("keeps the row selected without marking hidden streaming replies read during project selection", () => {
  const view = tabList({ tabs: { ...initialTabs, active: "chat" } });
  view.render({
    navigation: {
      open: vi.fn(async () => true),
      chatAction: vi.fn(async () => true),
      projectAction: vi.fn(async () => true),
      invalidate: vi.fn(),
      pending: false,
      busy: false,
      projectPending: true,
      conversationPending: false,
      error: "",
    },
  });
  const hidden = find(view.tree(), (element) => element.type === ProjectChatSidebar)
    .props as ComponentProps<typeof ProjectChatSidebar>;
  expect(hidden.open).toBe(true);
  expect(hidden.conversationVisible).toBe(false);
  expect(
    find(
      view.tree(),
      (element) => element.type === ChatSidebar && element.props.relayNavigation === true,
    ).props.conversationVisible,
  ).toBe(false);
  const child = mount(ChatSidebar, {
    ...hidden,
    chats: chats.map((chat) =>
      chat.run ? ({ ...chat, replies: { count: 1 } } as OrchestrationChat) : chat,
    ),
  });
  expect(byId(child.tree(), "conversation-chat").props["aria-current"]).toBe("true");
  expect(sessionStorage.setItem).not.toHaveBeenCalled();
  child.render({
    chats: chats.map((chat) =>
      chat.run ? ({ ...chat, replies: { count: 2 } } as OrchestrationChat) : chat,
    ),
  });
  expect(sessionStorage.setItem).not.toHaveBeenCalled();
  child.render({ conversationVisible: true });
  expect(sessionStorage.setItem).toHaveBeenLastCalledWith(expect.any(String), "2");
});

it("changes project disclosure only through its chevron, preserving it through selection and creation", () => {
  const onProjectOpen = vi.fn();
  const onAction = vi.fn(async () => true);
  const view = mount(ProjectChatSidebar, {
    ...chatProps,
    selectedId: "worker",
    projects: [project],
    selectedProjectId: "a",
    homeProjectId: "a" as string | undefined,
    onProjectOpen,
    onProjectAction: vi.fn(async () => true),
    onAction,
    ancestorsExpanded: true,
  });
  click(view.tree(), "project-a");
  view.render();
  expect(onProjectOpen).toHaveBeenCalledWith("a");
  expect(byId(view.tree(), "project-toggle-a").props["aria-expanded"]).toBe(true);
  click(view.tree(), "project-toggle-a");
  view.render();
  expect(byId(view.tree(), "project-toggle-a").props["aria-expanded"]).toBe(false);
  click(view.tree(), "project-a");
  view.render({ homeProjectId: undefined, selectedId: "chat", navigationSerial: 1 });
  expect(byId(view.tree(), "project-toggle-a").props["aria-expanded"]).toBe(false);
  const add = find(
    view.tree(),
    (element) => element.props.className === "icon-button project-session-add",
  );
  (add.props.onClick as () => void)();
  view.render({ selectedId: "new-chat", navigationSerial: 2 });
  expect(onAction).toHaveBeenCalledWith({ type: "new", projectId: "a" });
  expect(byId(view.tree(), "project-toggle-a").props["aria-expanded"]).toBe(false);
  view.render({ ancestorsExpanded: false });
  view.render({ ancestorsExpanded: true, homeProjectId: "a" });
  expect(byId(view.tree(), "project-toggle-a").props["aria-expanded"]).toBe(false);
  click(view.tree(), "project-toggle-a");
  view.render();
  view.render({ ancestorsExpanded: false });
  view.render({ ancestorsExpanded: true });
  expect(byId(view.tree(), "project-toggle-a").props["aria-expanded"]).toBe(true);
});

it("closes owned workers with their ancestor and preserves that collapse when the ancestor reopens", () => {
  const view = mount(ChatSidebar, { ...chatProps, ancestorsExpanded: true });
  expect(byId(view.tree(), "workers-chat").props.hidden).toBe(false);
  view.render({ ancestorsExpanded: false });
  expect(byId(view.tree(), "workers-chat").props.hidden).toBe(true);
  view.render({ ancestorsExpanded: true });
  expect(byId(view.tree(), "workers-chat").props.hidden).toBe(true);
  view.render({ selectedId: "worker", navigationSerial: 1 });
  expect(byId(view.tree(), "workers-chat").props.hidden).toBe(false);
});

it("propagates an explicit project-chevron collapse to its retained worker disclosures", () => {
  const view = mount(ProjectChatSidebar, {
    ...chatProps,
    projects: [project],
    selectedProjectId: "a",
    homeProjectId: "a",
    onProjectOpen: vi.fn(),
    onProjectAction: vi.fn(async () => true),
  });
  const childProps = () =>
    find(view.tree(), (element) => element.type === ChatSidebar).props as ComponentProps<
      typeof ChatSidebar
    >;
  const child = mount(ChatSidebar, childProps());
  expect(byId(child.tree(), "workers-chat").props.hidden).toBe(false);
  click(view.tree(), "project-toggle-a");
  view.render();
  child.render(childProps());
  expect(byId(child.tree(), "workers-chat").props.hidden).toBe(true);
  click(view.tree(), "project-toggle-a");
  view.render();
  child.render(childProps());
  expect(byId(view.tree(), "project-toggle-a").props["aria-expanded"]).toBe(true);
  expect(byId(child.tree(), "workers-chat").props.hidden).toBe(true);
});

it("shows Providers as a single tab in Connect", () => {
  const view = tabList({ tabs: { ...initialTabs, active: "providers" } });
  const tab = byId(view.tree(), "tab-providers");
  expect(tab.props["aria-controls"]).toBe("panel-providers");
  expect(tab.props["aria-selected"]).toBe(true);
  expect(tab.props["aria-expanded"]).toBeUndefined();
});
