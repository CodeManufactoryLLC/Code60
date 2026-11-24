import { Menu, MenuItem, MenuItemSelectable } from "@carbon/react";
import type { EffectCallback, ReactElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AnchoredMenu } from "./anchored-menu.js";

const hooks = vi.hoisted(() => ({ effect: undefined as EffectCallback | undefined }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useLayoutEffect: (effect: EffectCallback) => {
    hooks.effect = effect;
  },
  useRef: (current: unknown) => ({ current }),
}));
afterEach(() => vi.unstubAllGlobals());
it("passes disabled reasons, checked identities and guarded callbacks to upstream Carbon", () => {
  const run = vi.fn(),
    close = vi.fn();
  const tree = AnchoredMenu({
    x: 30,
    y: 80,
    label: "Actions",
    onClose: close,
    items: [
      { label: "Delete", disabled: true, reason: "Running", run },
      { id: "archived", label: "Archived", checked: true, describedBy: "help", run },
    ],
  }) as ReactElement<{ children: ReactElement<Record<string, unknown>>[] }>;
  expect(tree.type).toBe(Menu);
  const [disabled, checked] = tree.props.children;
  if (!disabled || !checked) throw new Error("Missing Carbon items");
  expect(disabled.type).toBe(MenuItem);
  expect(disabled.props).toMatchObject({ disabled: true, "aria-description": "Running" });
  (disabled.props.onClick as () => void)();
  expect(run).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(checked.type).toBe(MenuItemSelectable);
  expect(checked.key).toBe("archived");
  expect(checked.props).toMatchObject({ selected: true, "aria-describedby": "help" });
  (checked.props.onClick as () => void)();
  expect(run).toHaveBeenCalledOnce();
});
it("dismisses only on actual anchor movement and removes every owned listener/observer", () => {
  let y = 30,
    resized = () => {};
  class Element {
    contains = () => false;
    getBoundingClientRect = () => ({ x: 20, y, width: 40, height: 30 });
  }
  const anchor = new Element(),
    close = vi.fn(),
    disconnect = vi.fn();
  const listeners = new Map<string, (event: Event) => void>();
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("Node", Element);
  vi.stubGlobal("document", { activeElement: anchor });
  vi.stubGlobal("window", {
    addEventListener: (key: string, fn: (event: Event) => void) => listeners.set(key, fn),
    removeEventListener: (key: string) => listeners.delete(key),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(fn: () => void) {
        resized = fn;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  AnchoredMenu({
    x: 20,
    y: 60,
    anchor: anchor as unknown as HTMLElement,
    label: "Actions",
    items: [],
    onClose: close,
  });
  const cleanup = hooks.effect?.();
  listeners.get("scroll")?.({ type: "scroll", target: null } as unknown as Event);
  expect(close).not.toHaveBeenCalled();
  y += 20;
  resized();
  expect(close).toHaveBeenCalledOnce();
  if (typeof cleanup === "function") cleanup();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(listeners.size).toBe(0);
});
