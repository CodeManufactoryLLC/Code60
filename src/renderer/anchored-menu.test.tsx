import type { EffectCallback, ReactElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AnchoredMenu } from "./anchored-menu.js";

const hooks = vi.hoisted(() => ({
  effect: undefined as EffectCallback | undefined,
  focus: vi.fn(),
  position: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useLayoutEffect: (effect: EffectCallback) => {
    hooks.effect = effect;
  },
  useRef: (current: unknown) => ({
    current: current ?? {
      getBoundingClientRect: () => ({ width: 180, height: 160 }),
      querySelector: () => ({ focus: hooks.focus }),
      contains: () => false,
    },
  }),
  useState: (current: unknown) => [current, hooks.position],
}));
vi.mock("react-dom", () => ({ createPortal: (node: unknown) => node }));
afterEach(() => {
  hooks.focus.mockClear();
  hooks.position.mockClear();
  vi.unstubAllGlobals();
});

it("focuses a viewport-clamped menu without scrolling and immediately dismissing it", () => {
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("document", { body: {}, activeElement: null });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("innerWidth", 1100);
  vi.stubGlobal("innerHeight", 500);
  AnchoredMenu({ x: 200, y: 480, label: "Project actions", items: [], onClose: vi.fn() });
  const cleanup = hooks.effect?.();
  expect(hooks.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  if (typeof cleanup === "function") cleanup();
});

it("ignores queued scrolls but dismisses when the trigger actually moves", () => {
  let y = 470;
  class Element {
    isConnected = true;
    focus = vi.fn();
    getBoundingClientRect() {
      return { x: 200, y, width: 36, height: 36 };
    }
  }
  const anchor = new Element();
  const listeners = new Map<string, (event: Event) => void>();
  const onClose = vi.fn();
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("Node", Element);
  vi.stubGlobal("document", { body: {}, activeElement: anchor });
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: (event: Event) => void) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  });
  vi.stubGlobal("innerWidth", 1100);
  vi.stubGlobal("innerHeight", 500);
  AnchoredMenu({ x: 200, y: 480, label: "Project actions", items: [], onClose });
  const cleanup = hooks.effect?.();
  const scroll = listeners.get("scroll");
  if (!scroll) throw new Error("Missing scroll listener");
  scroll({ type: "scroll", target: {} } as Event);
  expect(onClose).not.toHaveBeenCalled();
  y -= 20;
  scroll({ type: "scroll", target: {} } as Event);
  expect(onClose).toHaveBeenCalledOnce();
  if (typeof cleanup === "function") cleanup();
  expect(listeners.size).toBe(0);
});

it("keeps disabled items focusable with a reason but never invokes them", () => {
  vi.stubGlobal("document", { body: {} });
  const run = vi.fn(),
    onClose = vi.fn();
  const menu = AnchoredMenu({
    x: 0,
    y: 0,
    label: "Providers",
    className: "provider-dropdown",
    id: "provider-actions",
    appearance: "neobrutalism",
    onClose,
    items: [
      { label: "Disconnect", disabled: true, reason: "Choose another primary", run },
      { label: "Set as Primary", run },
    ],
  });
  expect((menu as unknown as ReactElement<{ id: string; className: string }>).props).toMatchObject({
    id: "provider-actions",
    className: "actions-menu neo-dropdown-menu provider-dropdown",
  });
  const [disabled, enabled] = (
    menu as unknown as ReactElement<{
      children: [
        ReactElement<{ "aria-disabled": boolean; "aria-description": string; onClick(): void }>,
        ReactElement<{ onClick(): void }>,
      ];
    }>
  ).props.children;
  expect(disabled.props["aria-disabled"]).toBe(true);
  expect(disabled.props["aria-description"]).toBe("Choose another primary");
  disabled.props.onClick();
  expect(run).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  enabled.props.onClick();
  expect(run).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
});

it("exposes toggle commands with checkbox semantics and stable identities", () => {
  vi.stubGlobal("document", { body: {} });
  const run = vi.fn();
  const menu = AnchoredMenu({
    x: 0,
    y: 0,
    label: "Custom Assistants actions",
    onClose: vi.fn(),
    items: [{ id: "archived", label: "Archived", checked: true, describedBy: "help", run }],
  });
  const [item] = (
    menu as unknown as ReactElement<{ children: ReactElement<Record<string, unknown>>[] }>
  ).props.children;
  expect(item?.key).toBe("archived");
  expect(item?.props).toMatchObject({
    role: "menuitemcheckbox",
    "aria-checked": true,
    "aria-describedby": "help",
  });
});

it("never restores focus into a hidden owner when its menu is disposed", () => {
  class Element {
    isConnected = true;
    focus = vi.fn();
    closest = vi.fn(() => ({}));
    getBoundingClientRect = () => ({ x: 10, y: 10, width: 36, height: 36 });
  }
  const anchor = new Element();
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("document", { body: {}, activeElement: anchor });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("innerWidth", 800);
  vi.stubGlobal("innerHeight", 600);
  AnchoredMenu({
    x: 10,
    y: 50,
    label: "Chat actions",
    anchor: anchor as unknown as HTMLElement,
    items: [],
    onClose: vi.fn(),
  });
  const cleanup = hooks.effect?.();
  if (typeof cleanup === "function") cleanup();
  expect(anchor.focus).not.toHaveBeenCalled();
});

it("tracks a live title resize without replacing the menu or resetting focus", () => {
  let resized = () => {},
    x = 200;
  const title = {};
  class Element {
    isConnected = true;
    focus = vi.fn();
    closest = (selector: string) =>
      selector === ".content-page-heading" ? { querySelector: () => title } : null;
    getBoundingClientRect = () => ({
      x,
      y: 20,
      left: x,
      right: x + 36,
      top: 20,
      bottom: 56,
      width: 36,
      height: 36,
    });
  }
  const anchor = new Element(),
    observe = vi.fn(),
    disconnect = vi.fn();
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("document", { body: {}, activeElement: anchor });
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("innerWidth", 800);
  vi.stubGlobal("innerHeight", 600);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  AnchoredMenu({
    x: 236,
    y: 60,
    align: "end",
    anchor: anchor as unknown as HTMLElement,
    label: "Chat actions",
    items: [],
    onClose: vi.fn(),
  });
  const cleanup = hooks.effect?.();
  expect(observe.mock.calls).toEqual([[anchor], [title]]);
  x = 260;
  resized();
  const update = hooks.position.mock.lastCall?.[0] as (current: { left: number; top: number }) => {
    left: number;
    top: number;
  };
  expect(update({ left: 56, top: 60 })).toEqual({ left: 116, top: 60 });
  expect(hooks.focus).toHaveBeenCalledTimes(1);
  expect(anchor.focus).not.toHaveBeenCalled();
  const calls = hooks.position.mock.calls.length;
  if (typeof cleanup === "function") cleanup();
  expect(disconnect).toHaveBeenCalledOnce();
  resized();
  expect(hooks.position).toHaveBeenCalledTimes(calls);
});
