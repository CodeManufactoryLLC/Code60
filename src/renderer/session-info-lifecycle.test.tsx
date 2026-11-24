import type { DependencyList, EffectCallback } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { SessionState } from "../core/index.js";
import { SessionOptionPicker } from "./session-info.js";

const hooks = vi.hoisted(() => ({
  dependencies: undefined as DependencyList | undefined,
  layout: undefined as EffectCallback | undefined,
  refs: [] as unknown[],
  open: false,
  setOpen: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useId: () => "mode-menu",
  useEffect: (_effect: EffectCallback, dependencies: DependencyList) => {
    hooks.dependencies = dependencies;
  },
  useLayoutEffect: (effect: EffectCallback) => {
    hooks.layout = effect;
  },
  useRef: () => ({ current: hooks.refs.shift() ?? null }),
  useState: () => [hooks.open, hooks.setOpen],
}));
afterEach(() => {
  hooks.open = false;
  hooks.refs = [];
  hooks.setOpen.mockClear();
  vi.unstubAllGlobals();
});

it("keeps harness choices through unrelated scrolls, but dismisses a moved anchor", () => {
  let y = 470;
  let width = 180;
  class Node {}
  const child = new Node();
  const focus = vi.fn();
  const popup = {
    showPopover: vi.fn(),
    hidePopover: vi.fn(),
    style: {},
    getBoundingClientRect: () => ({ width: 180, height: 160 }),
    querySelector: () => ({ focus }),
    contains: (target: unknown) => target === child,
  };
  const button = {
    parentElement: {
      getBoundingClientRect: () => ({ x: 200, y, width: 180, height: 36 }),
    },
    getBoundingClientRect: () => ({ x: 200, y, left: 200, top: y, width, height: 36 }),
  };
  const listeners = new Map<string, (event: Event) => void>();
  const events = {
    addEventListener: (type: string, listener: (event: Event) => void) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  vi.stubGlobal("Node", Node);
  vi.stubGlobal("document", events);
  vi.stubGlobal("window", events);
  vi.stubGlobal("innerWidth", 1100);
  hooks.open = true;
  hooks.refs = [button, popup];
  SessionOptionPicker({
    controls: [],
    source: "config",
    confirmed: true,
    label: "Harness mode",
    menuLabel: "Harness modes",
    selected: "Ask",
    tip: "Harness mode: Ask",
    ended: false,
    editable: true,
    changing: false,
    sessionId: "same-session",
    onMode: vi.fn(),
  });
  const cleanup = hooks.layout?.();
  expect(focus).not.toHaveBeenCalled();
  const scroll = listeners.get("scroll");
  if (!scroll) throw new Error("Missing scroll listener");
  // Delegated press feedback scales the button, not its stationary layout container.
  width = 178;
  scroll({ target: new Node() } as unknown as Event);
  expect(hooks.setOpen).not.toHaveBeenCalled();
  y -= 20;
  scroll({ target: child } as unknown as Event);
  expect(hooks.setOpen).not.toHaveBeenCalled();
  scroll({ target: new Node() } as unknown as Event);
  expect(hooks.setOpen).toHaveBeenCalledExactlyOnceWith(false);
  if (typeof cleanup === "function") cleanup();
  expect(popup.hidePopover).not.toHaveBeenCalled();
  expect(listeners.size).toBe(0);
});

it("keeps an open mode menu across equivalent pushed snapshots, but not capability changes", () => {
  const state: SessionState = {
    model: null,
    usage: null,
    modes: {
      source: "config",
      confirmed: true,
      reportedAt: "2026-11-14T12:00:00.000Z",
      controls: [
        { id: "mode", name: "Mode", currentValue: "ask", options: [{ value: "ask", name: "Ask" }] },
      ],
    },
  };
  const render = (state: SessionState) =>
    SessionOptionPicker({
      controls: state.modes?.controls ?? [],
      source: state.modes?.source ?? "config",
      confirmed: state.modes?.confirmed ?? false,
      label: "Harness mode",
      menuLabel: "Harness modes",
      selected: "Ask",
      tip: "Harness mode: Ask",
      ended: false,
      editable: true,
      changing: false,
      sessionId: "same-session",
      onMode: vi.fn(),
    });
  render(state);
  const before = hooks.dependencies;
  const clone = structuredClone(state);
  if (!clone.modes) throw new Error("Missing modes");
  clone.modes.reportedAt = "2026-11-14T12:00:01.000Z";
  render(clone);
  expect(hooks.dependencies?.every((value, index) => Object.is(value, before?.[index]))).toBe(true);
  clone.modes.controls[0]?.options.push({ value: "full", name: "Full Access" });
  render(clone);
  expect(hooks.dependencies?.every((value, index) => Object.is(value, before?.[index]))).toBe(
    false,
  );
});
