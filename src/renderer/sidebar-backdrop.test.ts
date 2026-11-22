import { afterEach, expect, it, vi } from "vitest";
import { inactiveSidebarBackdrop } from "../bridge/index.js";
import { observeSidebarBackdrop } from "./sidebar-backdrop.js";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const document = Object.assign(new EventTarget(), {
    hidden: false,
    querySelector: vi.fn(() => ({ getBoundingClientRect: () => ({ width: 1280 }) })),
  });
  const forced = Object.assign(new EventTarget(), { matches: false });
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0;
  let resized = () => {};
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { matchMedia: () => forced });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  let nativeFailure = () => {};
  const unsubscribe = vi.fn();
  const api = {
    setSidebarBackdrop: vi.fn(async () => {}),
    onSidebarBackdropError: vi.fn((listener: () => void) => {
      nativeFailure = listener;
      return unsubscribe;
    }),
  };
  const error = vi.fn();
  const stop = observeSidebarBackdrop(api, { opacity: 35, blur: 65 }, false, error);
  return {
    document,
    frames,
    api,
    error,
    stop,
    disconnect,
    unsubscribe,
    resize: () => resized(),
    fail: () => nativeFailure(),
  };
}

it("reports hidden visibility immediately even when animation frames stop", async () => {
  const f = fixture();
  await vi.waitFor(() => expect(f.error).toHaveBeenLastCalledWith(""));
  expect(f.document.querySelector).toHaveBeenCalledWith(".window-background");
  expect(f.api.setSidebarBackdrop).toHaveBeenLastCalledWith({
    width: 1280,
    strength: 65,
    visible: true,
  });
  f.resize();
  expect(f.frames.size).toBe(1);
  f.document.hidden = true;
  f.document.dispatchEvent(new Event("visibilitychange"));
  expect(f.frames.size).toBe(0);
  expect(f.api.setSidebarBackdrop).toHaveBeenLastCalledWith({
    width: 1280,
    strength: 0,
    visible: false,
  });
  f.stop();
  expect(f.api.setSidebarBackdrop).toHaveBeenLastCalledWith(inactiveSidebarBackdrop);
  expect(f.disconnect).toHaveBeenCalledOnce();
  expect(f.unsubscribe).toHaveBeenCalledOnce();
});

it("keeps native failures visible until a successful retry and discards late results", async () => {
  const f = fixture();
  await vi.waitFor(() => expect(f.error).toHaveBeenLastCalledWith(""));
  f.fail();
  expect(f.error).toHaveBeenLastCalledWith(expect.stringContaining("could not be applied"));
  f.api.setSidebarBackdrop.mockRejectedValueOnce(new Error("private native detail"));
  f.document.hidden = true;
  f.document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() =>
    expect(f.error).toHaveBeenLastCalledWith(expect.stringContaining("could not be applied")),
  );
  f.document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => expect(f.error).toHaveBeenLastCalledWith(""));
  let complete = () => {};
  f.api.setSidebarBackdrop.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  f.document.dispatchEvent(new Event("visibilitychange"));
  f.fail();
  complete();
  await Promise.resolve();
  expect(f.error).toHaveBeenLastCalledWith(expect.stringContaining("could not be applied"));
  f.stop();
  const count = f.error.mock.calls.length;
  await Promise.resolve();
  expect(f.error).toHaveBeenCalledTimes(count);
});
