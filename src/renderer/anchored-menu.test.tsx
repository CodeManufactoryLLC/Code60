import type { EffectCallback } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { AnchoredMenu } from "./anchored-menu.js";

const hooks = vi.hoisted(() => ({
  effect: undefined as EffectCallback | undefined,
  focus: vi.fn(),
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
    },
  }),
  useState: (current: unknown) => [current, vi.fn()],
}));
vi.mock("react-dom", () => ({ createPortal: (node: unknown) => node }));
afterEach(() => vi.unstubAllGlobals());

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
