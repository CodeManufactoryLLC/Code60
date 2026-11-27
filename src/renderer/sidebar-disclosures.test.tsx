import {
  type ComponentProps,
  type DependencyList,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PageTabBar } from "./page-tabs.js";
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

// Supporting lifecycle tests only. Real DOM, CSS and IPC are covered by the browser journey.
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
function click(tree: ReactNode, id: string) {
  (byId(tree, id).props.onClick as () => void)();
}

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
    database: "/db",
    chats: [],
    tabs: { ...initialTabs, active: "settings" },
    settingsSection: null,
    onSelect: vi.fn(),
    onOpenChat: vi.fn(),
    onSettingsSectionSelect: vi.fn(),
    navigation: { busy: false },
    ...overrides,
  };
  const shell = mount(PageTabBar, props);
  const list = find(
    shell.tree(),
    (element) => typeof element.type === "function" && element.type.name === "PageTabList",
  );
  return mount(list.type as (value: typeof props) => ReactNode, list.props as typeof props);
}

it("activates Chat through the top-level Chat button", () => {
  const onOpenChat = vi.fn();
  const view = tabList({ onOpenChat });
  click(view.tree(), "tab-chat");
  expect(onOpenChat).toHaveBeenCalledExactlyOnceWith();
});

it("places Workflows in Automate and Custom Assistants in Customize", () => {
  const view = tabList({ tabs: { ...initialTabs, active: "workflows" } });
  const group = (title: string) =>
    find(
      view.tree(),
      (element) =>
        typeof element.type === "function" &&
        element.type.name === "NavigationSection" &&
        element.props.title === title,
    );
  expect(group("Automate").props.destination).toBeDefined();
  expect(group("Customize").props.destination).toBeUndefined();
  expect(() => group("Develop")).toThrow("Missing navigation element");
  expect(() => group("Chat")).toThrow("Missing navigation element");

  view.render({ tabs: { ...initialTabs, active: "custom-agents" } });
  expect(group("Automate").props.destination).toBeUndefined();
  expect(group("Customize").props.destination).toBeDefined();
  const customTab = byId(view.tree(), "tab-custom-agents");
  expect(customTab.props["aria-controls"]).toBe("panel-custom-agents");
  expect(customTab.props["aria-expanded"]).toBeUndefined();

  view.render({ tabs: { ...initialTabs, active: "vector-search" } });
  expect(group("Context").props.destination).toBeDefined();
  expect(group("Customize").props.destination).toBeUndefined();
});

it("shows Providers as a single tab in Connect", () => {
  const view = tabList({ tabs: { ...initialTabs, active: "providers" } });
  const tab = byId(view.tree(), "tab-providers");
  expect(tab.props["aria-controls"]).toBe("panel-providers");
  expect(tab.props["aria-selected"]).toBe(true);
  expect(tab.props["aria-expanded"]).toBeUndefined();
});
