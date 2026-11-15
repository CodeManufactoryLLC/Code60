import {
  type ComponentProps,
  type DependencyList,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopRun, OrchestrationChat } from "../bridge/index.js";
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
    run: { id: "chat", status: "idle", turns: 0, pending: [] },
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

function tabList() {
  const props: ComponentProps<typeof PageTabBar> = {
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
      projectPending: false,
      error: "",
    },
  };
  const shell = mount(PageTabBar, props);
  const list = find(
    shell.tree(),
    (element) => typeof element.type === "function" && element.type.name === "PageTabList",
  );
  return mount(list.type as (value: typeof props) => ReactNode, list.props as typeof props);
}

it.each([
  ["finished", "Finished"],
  ["interrupted", "Interrupted"],
] as const)(
  "hides visible %s labels while preserving accessible status and unread counts",
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
    expect(
      find(row, (element) => element.props.className === "chat-unread").props["aria-label"],
    ).toBe("1 unread reply");
    expect(() =>
      find(view.tree(), (element) => element.props.className === "chat-sidebar-status"),
    ).toThrow("Missing navigation element");
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

it.each(["click", "ArrowLeft"] as const)(
  "recursively closes Settings descendants via %s without changing the page",
  (method) => {
    const view = tabList();
    expect(byId(view.tree(), "advanced-toggle").props["aria-expanded"]).toBe(true);
    expect(byId(view.tree(), "experiments-toggle").props["aria-expanded"]).toBe(true);
    if (method === "click") click(view.tree(), "tab-settings");
    else press(view.tree(), "tab-settings", method);
    view.render();
    for (const id of ["settings-pages", "advanced-pages", "experiment-pages"]) {
      expect(byId(view.tree(), id).props.hidden).toBe(true);
      expect(byId(view.tree(), id).props.inert).toBe(true);
    }
    press(view.tree(), "tab-settings", "ArrowRight");
    view.render();
    expect(byId(view.tree(), "settings-pages").props.hidden).toBe(false);
    expect(byId(view.tree(), "advanced-toggle").props["aria-expanded"]).toBe(false);
    expect(byId(view.tree(), "experiments-toggle").props["aria-expanded"]).toBe(false);
  },
);

it("closes Data Viewer when Apps closes, including when invoked from a child", () => {
  const view = tabList();
  press(view.tree(), "tab-commands", "ArrowLeft");
  view.render();
  expect(byId(view.tree(), "app-pages").props.hidden).toBe(true);
  expect(byId(view.tree(), "table-pages").props.hidden).toBe(true);
});

it("does not reveal Projects for Relay while its selection snapshot is delayed", () => {
  const view = tabList();
  press(view.tree(), "tab-chat", "ArrowLeft");
  view.render();
  const navigation = {
    open: vi.fn(async () => true),
    chatAction: vi.fn(async () => true),
    projectAction: vi.fn(async () => true),
    invalidate: vi.fn(),
    pending: false,
    projectPending: false,
    error: "",
    destination: { kind: "conversation", id: "relay" } as const,
  };
  view.render({ tabs: { ...initialTabs, active: "chat" }, navigation });
  expect(byId(view.tree(), "chat-pages").props.hidden).toBe(true);
  view.render({ selectedId: "relay" });
  expect(byId(view.tree(), "chat-pages").props.hidden).toBe(true);
  view.render({
    selectedId: "chat",
    navigation: { ...navigation, destination: { kind: "conversation", id: "chat" } },
  });
  expect(byId(view.tree(), "chat-pages").props.hidden).toBe(false);
});

it("closes all project accordions on ancestor collapse and does not reopen them for Relay", () => {
  const view = mount(ProjectChatSidebar, {
    ...chatProps,
    projects: [project],
    selectedProjectId: "a",
    homeProjectId: "a" as string | undefined,
    onProjectOpen: vi.fn(),
    onProjectAction: vi.fn(async () => true),
    ancestorsExpanded: true,
    destination: undefined as ComponentProps<typeof ProjectChatSidebar>["destination"],
  });
  view.render({ ancestorsExpanded: false });
  expect(byId(view.tree(), "project-a").props["aria-expanded"]).toBe(false);
  view.render({ homeProjectId: undefined, destination: { kind: "conversation", id: "relay" } });
  view.render({ selectedId: "relay", ancestorsExpanded: true });
  expect(byId(view.tree(), "project-a").props["aria-expanded"]).toBe(false);
  view.render({ destination: { kind: "conversation", id: "chat" } });
  expect(byId(view.tree(), "project-a").props["aria-expanded"]).toBe(true);
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

it("propagates a project-label collapse to its retained worker disclosures", () => {
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
  click(view.tree(), "project-a");
  view.render();
  child.render(childProps());
  expect(byId(child.tree(), "workers-chat").props.hidden).toBe(true);
  click(view.tree(), "project-a");
  view.render();
  child.render(childProps());
  expect(byId(view.tree(), "project-a").props["aria-expanded"]).toBe(true);
  expect(byId(child.tree(), "workers-chat").props.hidden).toBe(true);
});
