import type { RefObject } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  observeBreadcrumbHeader,
  observeBreadcrumbRightInset,
  useBreadcrumbHeader,
} from "./page-title-header.js";

const hooks = vi.hoisted(() => ({
  publish: vi.fn(),
  effects: [] as (() => (() => void) | undefined)[],
}));
vi.mock("react", () => ({
  useState: () => [null, hooks.publish],
  useLayoutEffect: (effect: () => (() => void) | undefined) => hooks.effects.push(effect),
}));

const observers: {
  update(): void;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}[] = [];
beforeEach(() => {
  observers.length = 0;
  hooks.effects.length = 0;
  hooks.publish.mockClear();
  vi.stubGlobal(
    "MutationObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(public update: () => void) {
        observers.push(this);
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

it("tracks the right panel divider, restores stacked/closed width and releases queued resize work", () => {
  let resized = () => {};
  const disconnect = vi.fn();
  const observe = vi.fn();
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
  let conversationRight = 800;
  let headerPresent = true;
  const values = new Map<string, string>();
  const conversations = { getBoundingClientRect: () => ({ right: conversationRight }) };
  const header = { getBoundingClientRect: () => ({ right: 1000, width: 900 }) };
  const workspace = {
    querySelector: (selector: string) =>
      headerPresent
        ? selector === ".workspace-breadcrumbs"
          ? { getBoundingClientRect: () => ({ top: 40 }) }
          : header
        : null,
    style: {
      getPropertyValue: (name: string) => values.get(name) ?? "",
      setProperty: vi.fn((name: string, value: string) => values.set(name, value)),
      removeProperty: (name: string) => values.delete(name),
    },
  };
  let bodyTop = 170;
  const body = {
    closest: () => workspace,
    querySelector: () => conversations,
    getBoundingClientRect: () => ({ top: bodyTop }),
  };
  const stop = observeBreadcrumbRightInset(body as unknown as HTMLElement);
  expect(values.get("--breadcrumb-right-inset")).toBe("200px");
  expect(observe.mock.calls.map(([element]) => element)).toEqual([
    conversations,
    workspace,
    header,
  ]);
  expect(values.get("--right-panel-rise")).toBe("130px");
  resized();
  expect(workspace.style.setProperty).toHaveBeenCalledTimes(2);
  bodyTop = 190;
  resized();
  expect(values.get("--right-panel-rise")).toBe("150px");
  conversationRight = 650;
  resized();
  expect(values.get("--breadcrumb-right-inset")).toBe("350px");
  conversationRight = 984; // The stacked transcript retains its vertical scrollbar gutter.
  resized();
  expect(values.get("--right-panel-rise")).toBe("150px");
  expect(values.get("--breadcrumb-right-inset")).toBe("16px");
  conversationRight = 650;
  resized();
  expect(values.get("--breadcrumb-right-inset")).toBe("350px");
  conversationRight = 1000;
  resized();
  expect(values.get("--breadcrumb-right-inset")).toBe("0px");
  headerPresent = false;
  conversationRight = 650;
  resized();
  expect(values.get("--breadcrumb-right-inset")).toBe("0px");
  stop();
  expect(disconnect).toHaveBeenCalledOnce();
  headerPresent = true;
  resized();
  expect(values.has("--breadcrumb-right-inset")).toBe(false);
  expect(values.has("--right-panel-rise")).toBe(false);
});

it.each(["workspace", "conversations"])(
  "ignores a missing %s when no chat layout is mounted",
  (missing) => {
    const body = {
      closest: () => (missing === "workspace" ? null : {}),
      querySelector: () => null,
    };
    expect(observeBreadcrumbRightInset(body as unknown as HTMLElement)).toBeTypeOf("function");
  },
);

function fixture() {
  let hidden = false;
  let inert = false;
  let selectionPending = false;
  const header = {} as HTMLElement;
  const workspace = { querySelector: vi.fn((): HTMLElement | null => header) };
  const outer = { parentElement: null };
  const parent = {
    parentElement: outer,
    closest: vi.fn((selector: string) =>
      hidden || (inert && !(selectionPending && selector.includes("data-navigation-pending")))
        ? parent
        : null,
    ),
  };
  const element = {
    parentElement: parent,
    closest: vi.fn(() => workspace),
  } as unknown as HTMLElement;
  return {
    element,
    header,
    workspace,
    parent,
    outer,
    hide: (value: boolean) => {
      hidden = value;
    },
    makeInert: (value: boolean) => {
      inert = value;
    },
    selectPending: (value: boolean) => {
      selectionPending = value;
    },
  };
}

it("publishes only a visible breadcrumb and observes retained ancestor activation", () => {
  const view = fixture();
  const publish = vi.fn();
  observeBreadcrumbHeader(view.element, publish);
  expect(publish).toHaveBeenLastCalledWith(view.header);
  expect(observers[0]?.observe.mock.calls).toEqual(
    [view.parent, view.outer].map((parent) => [
      parent,
      { attributes: true, attributeFilter: ["hidden", "inert"] },
    ]),
  );
  view.hide(true);
  observers[0]?.update();
  expect(publish).toHaveBeenLastCalledWith(null);
  view.hide(false);
  observers[0]?.update();
  expect(publish).toHaveBeenLastCalledWith(view.header);
});

it("keeps already-hidden and inert retained project/settings/worker views out of the header", () => {
  for (const state of ["hidden", "inert"] as const) {
    const view = fixture();
    if (state === "hidden") view.hide(true);
    else view.makeInert(true);
    const publish = vi.fn();
    observeBreadcrumbHeader(view.element, publish);
    expect(publish).toHaveBeenCalledExactlyOnceWith(null);
  }
});

it("retains a pending selection's visible title while its chat controls are inert", () => {
  const view = fixture();
  view.makeInert(true);
  view.selectPending(true);
  const publish = vi.fn();
  observeBreadcrumbHeader(view.element, publish);
  expect(publish).toHaveBeenLastCalledWith(view.header);
  view.hide(true);
  observers[0]?.update();
  expect(publish).toHaveBeenLastCalledWith(null);
});

it("switches active owners without a hidden view claiming the shared header", () => {
  const first = fixture();
  const second = fixture();
  second.workspace.querySelector.mockReturnValue(first.header);
  second.hide(true);
  const a = vi.fn();
  const b = vi.fn();
  observeBreadcrumbHeader(first.element, a);
  observeBreadcrumbHeader(second.element, b);
  expect(a).toHaveBeenLastCalledWith(first.header);
  expect(b).toHaveBeenLastCalledWith(null);
  first.hide(true);
  second.hide(false);
  for (const observer of observers) observer.update();
  expect(a).toHaveBeenLastCalledWith(null);
  expect(b).toHaveBeenLastCalledWith(first.header);
  first.hide(false);
  second.hide(true);
  for (const observer of observers) observer.update();
  expect(a).toHaveBeenLastCalledWith(first.header);
  expect(b).toHaveBeenLastCalledWith(null);
});

it("does not publish a target when no app header exists", () => {
  const view = fixture();
  view.workspace.querySelector.mockReturnValue(null);
  const publish = vi.fn();
  observeBreadcrumbHeader(view.element, publish);
  expect(publish).toHaveBeenCalledExactlyOnceWith(null);
});

it("disconnects on disposal and ignores already queued observer callbacks", () => {
  const view = fixture();
  const publish = vi.fn();
  const dispose = observeBreadcrumbHeader(view.element, publish);
  dispose();
  expect(observers[0]?.disconnect).toHaveBeenCalledOnce();
  publish.mockClear();
  observers[0]?.update();
  expect(publish).not.toHaveBeenCalled();
});

it.each([false, true])(
  "keeps the in-page trail when header mode is %s with no mounted slot",
  (enabled) => {
    useBreadcrumbHeader({ current: null }, enabled);
    hooks.effects[0]?.();
    expect(hooks.publish).toHaveBeenCalledExactlyOnceWith(null);
    expect(observers).toHaveLength(0);
  },
);

it("connects the mounted slot and releases its observer when header mode changes", () => {
  const view = fixture();
  useBreadcrumbHeader({ current: view.element } as RefObject<HTMLElement>, true);
  const dispose = hooks.effects[0]?.();
  expect(hooks.publish).toHaveBeenLastCalledWith(view.header);
  dispose?.();
  expect(observers[0]?.disconnect).toHaveBeenCalledOnce();
});

it("hands off retained portals in the layout phase before observer delivery", () => {
  const view = fixture();
  useBreadcrumbHeader({ current: view.element }, true);
  hooks.effects[0]?.();
  hooks.publish.mockClear();
  view.hide(true);
  hooks.effects[1]?.();
  expect(hooks.publish).toHaveBeenLastCalledWith(null);
  view.hide(false);
  hooks.effects[1]?.();
  expect(hooks.publish).toHaveBeenLastCalledWith(view.header);
});
