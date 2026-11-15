import type { EffectCallback } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SystemManagerPage } from "./system-manager.js";

const hooks = vi.hoisted(() => ({
  effects: [] as EffectCallback[],
  setters: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => {
    const setter = vi.fn();
    hooks.setters.push(setter);
    return [value, setter];
  },
}));
beforeEach(() => {
  hooks.effects = [];
  hooks.setters = [];
});
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

it.each([false, true])(
  "keeps a queued status refresh after failure, disposed=%s",
  async (disposed) => {
    let rejectFirst: (reason: Error) => void = () => {};
    const first = new Promise<unknown>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const next = { pausedAll: false };
    const automation = vi.fn().mockReturnValueOnce(first).mockResolvedValue(next);
    let changed = () => {};
    const off = vi.fn();
    SystemManagerPage({
      active: true,
      api: {
        automation,
        onAutomationChanged: (listener) => {
          changed = listener;
          return off;
        },
      },
    });
    const cleanup = hooks.effects[0]?.();
    if (typeof cleanup !== "function") throw new Error("Missing status subscription cleanup");
    dispose = cleanup;
    expect(automation).toHaveBeenCalledTimes(1);
    changed();
    expect(automation).toHaveBeenCalledTimes(1);
    if (disposed) cleanup();
    rejectFirst(new Error("Synthetic unavailable status"));
    await vi.waitFor(() => expect(automation).toHaveBeenCalledTimes(disposed ? 1 : 2));
    if (disposed) {
      expect(off).toHaveBeenCalled();
      expect(hooks.setters[0]).not.toHaveBeenCalled();
    } else {
      await vi.waitFor(() => expect(hooks.setters[0]).toHaveBeenLastCalledWith(next));
      expect(hooks.setters[1]).toHaveBeenLastCalledWith("");
    }
  },
);
