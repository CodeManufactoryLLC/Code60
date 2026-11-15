import { afterEach, expect, it, vi } from "vitest";
import type { DesktopApi } from "../bridge/index.js";
import { useWindowAppearance } from "./window-appearance.js";

const effects = vi.hoisted(() => [] as (() => () => void)[]);
vi.mock("react", () => ({
  useState: () => [false, vi.fn()],
  useEffect: (effect: () => () => void) => effects.push(effect),
}));
afterEach(() => {
  effects.length = 0;
  vi.unstubAllGlobals();
});

it.each([
  { control: "title-bar toggle", selector: ".sidebar-toggle", x: 94, y: 14 },
  { control: "header breadcrumbs", selector: ".workspace-breadcrumbs", x: 300, y: 36 },
])(
  "keeps $control clickable after entering transparent margins and restores hit testing on disposal",
  async ({ selector, x, y }) => {
    const events = new EventTarget();
    const glyph = {
      closest: (selectors: string) => (selectors.split(", ").includes(selector) ? {} : null),
    };
    vi.stubGlobal("window", events);
    vi.stubGlobal("document", {
      documentElement: { dataset: {} },
      elementFromPoint: (px: number, py: number) => (px === x && py === y ? glyph : null),
      querySelector: () => null,
    });
    const hitTest = vi.fn(async (_ignore: boolean) => {});
    const api = {
      windowAppearance: async () => ({ transparent: true, enabled: true, clickThrough: true }),
      setBackgroundHitTest: hitTest,
    } as unknown as DesktopApi;
    const error = vi.fn();
    useWindowAppearance(api, error);
    const dispose = effects[0]?.();
    await Promise.resolve();
    const move = (x: number, y: number) =>
      events.dispatchEvent(Object.assign(new Event("mousemove"), { clientX: x, clientY: y }));
    move(300, 14);
    expect(hitTest).toHaveBeenLastCalledWith(true);
    move(x, y);
    expect(hitTest).toHaveBeenLastCalledWith(false);
    move(300, 14);
    move(30, 14);
    expect(hitTest).toHaveBeenLastCalledWith(false);
    move(300, 14);
    dispose?.();
    expect(hitTest).toHaveBeenLastCalledWith(false);
    hitTest.mockClear();
    move(300, 14);
    expect(hitTest).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  },
);
