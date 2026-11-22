import { afterEach, expect, it, vi } from "vitest";
import type { DesktopApi } from "../bridge/index.js";
import { useWindowAppearance } from "./window-appearance.js";

const hooks = vi.hoisted(() => ({
  effects: [] as (() => () => void)[],
  setters: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock("react", () => ({
  useState: () => {
    const set = vi.fn();
    hooks.setters.push(set);
    return [false, set];
  },
  useEffect: (effect: () => () => void) => hooks.effects.push(effect),
}));
afterEach(() => {
  hooks.effects.length = 0;
  hooks.setters.length = 0;
});

it.each([false, true])(
  "reads native capabilities without restoring the legacy transparent toggle (%s)",
  async (legacy) => {
    const windowAppearance = vi.fn(async () => ({
      transparent: legacy,
      enabled: legacy,
      clickThrough: legacy,
      customWindowControls: true,
      sidebarBlurSupported: false,
    }));
    const setTransparent = vi.fn(),
      setBackgroundHitTest = vi.fn(),
      error = vi.fn();
    const result = useWindowAppearance(
      { windowAppearance, setTransparent, setBackgroundHitTest } as unknown as DesktopApi,
      error,
    );
    const dispose = hooks.effects[0]?.();
    await Promise.resolve();
    expect(windowAppearance).toHaveBeenCalledOnce();
    expect(hooks.setters[0]).toHaveBeenCalledWith(true);
    expect(hooks.setters[1]).toHaveBeenCalledWith(false);
    expect(result).not.toHaveProperty("transparent");
    expect(result).not.toHaveProperty("saveTransparent");
    expect(setTransparent).not.toHaveBeenCalled();
    expect(setBackgroundHitTest).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    dispose?.();
  },
);

it("discards a native capability response after disposal", async () => {
  let complete: (value: unknown) => void = () => {};
  const pending = new Promise((resolve) => {
    complete = resolve;
  });
  useWindowAppearance({ windowAppearance: () => pending } as unknown as DesktopApi, vi.fn());
  const dispose = hooks.effects[0]?.();
  dispose?.();
  complete({ customWindowControls: true, sidebarBlurSupported: true });
  await Promise.resolve();
  expect(hooks.setters.every((set) => set.mock.calls.length === 0)).toBe(true);
});

it("reports capability failures without changing slider preferences", async () => {
  const error = vi.fn();
  useWindowAppearance(
    {
      windowAppearance: async () => {
        throw new Error("Window capabilities unavailable");
      },
    } as unknown as DesktopApi,
    error,
  );
  hooks.effects[0]?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(error).toHaveBeenCalledWith("Window capabilities unavailable");
  expect(hooks.setters.every((set) => set.mock.calls.length === 0)).toBe(true);
});
