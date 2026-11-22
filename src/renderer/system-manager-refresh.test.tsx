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
  vi.useFakeTimers();
  vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false }));
  hooks.effects = [];
  hooks.setters = [];
});
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
    await vi.advanceTimersByTimeAsync(0);
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

const available = { installed: false, nativeState: "stopped", service: null };
function mount(
  pollingPaused = false,
  active = true,
  automation = vi.fn().mockResolvedValue(available),
) {
  const element = SystemManagerPage({
    active,
    pollingPaused,
    api: { automation, onAutomationChanged: () => () => {} },
  });
  const cleanups = hooks.effects.map((effect) => effect());
  dispose = () => {
    for (const cleanup of cleanups.reverse()) if (typeof cleanup === "function") cleanup();
  };
  return { element, automation };
}

it("polls silently without disabling controls or clearing action feedback", async () => {
  const { automation } = mount();
  await vi.advanceTimersByTimeAsync(0);
  expect(automation).toHaveBeenCalledTimes(1);
  hooks.setters[3]?.mockClear();
  hooks.setters[4]?.mockClear();
  await vi.advanceTimersByTimeAsync(2000);
  expect(automation).toHaveBeenCalledTimes(2);
  expect(hooks.setters[3]).not.toHaveBeenCalledWith(true);
  expect(hooks.setters[4]).not.toHaveBeenCalled();
});

it("respects global polling pause while retaining initial and manual status reads", async () => {
  const { automation, element } = mount(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(automation).toHaveBeenCalledTimes(1);
  element.props.children[0].props.children.props.actions[0].run();
  await vi.advanceTimersByTimeAsync(0);
  expect(automation).toHaveBeenCalledTimes(2);
});

it("performs no reads or installs no timers for inactive pages", async () => {
  const { automation } = mount(false, false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(automation).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("backs off failures and resets the interval after recovery", async () => {
  const automation = vi
    .fn()
    .mockRejectedValueOnce(new Error("synthetic unavailable status"))
    .mockResolvedValue(available);
  mount(false, true, automation);
  await vi.advanceTimersByTimeAsync(3999);
  expect(automation).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(automation).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000);
  expect(automation).toHaveBeenCalledTimes(3);
  expect(hooks.setters[0]).toHaveBeenLastCalledWith(available);
});

it("discards a hidden response and reads fresh status when shown again", async () => {
  let finish = (_value: unknown) => {};
  const automation = vi
    .fn()
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValue(available);
  mount(false, true, automation);
  await vi.advanceTimersByTimeAsync(0);
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  document.dispatchEvent(new Event("visibilitychange"));
  finish({ installed: true, nativeState: "stopped", service: null });
  await vi.advanceTimersByTimeAsync(0);
  expect(hooks.setters[0]).not.toHaveBeenCalled();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(automation).toHaveBeenCalledTimes(2);
  expect(hooks.setters[0]).toHaveBeenCalledExactlyOnceWith(available);
});

it("caps retries of unavailable native supervision at sixty seconds", async () => {
  const automation = vi.fn().mockResolvedValue({
    installed: null,
    nativeState: "unavailable",
    service: null,
  });
  mount(false, true, automation);
  await vi.advanceTimersByTimeAsync(0);
  for (const delay of [4000, 8000, 16_000, 32_000, 60_000, 60_000]) {
    const previous = automation.mock.calls.length;
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(automation).toHaveBeenCalledTimes(previous);
    await vi.advanceTimersByTimeAsync(1);
    expect(automation).toHaveBeenCalledTimes(previous + 1);
  }
});
