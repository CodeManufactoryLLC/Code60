import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { observeServiceStatusPolling } from "./service-status-polling.js";

let documentState: EventTarget & { hidden: boolean };
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  documentState = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("document", documentState);
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("waits for a read to finish before scheduling the next check", async () => {
  let finish = () => {};
  const first = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const read = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
  dispose = observeServiceStatusPolling(read, () => 2000);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(read).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(1999);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(read).toHaveBeenCalledTimes(2);
});

it("stops while hidden and refreshes immediately when shown", async () => {
  documentState.hidden = true;
  const read = vi.fn().mockResolvedValue(undefined);
  dispose = observeServiceStatusPolling(read, () => 2000);
  expect(read).not.toHaveBeenCalled();
  documentState.hidden = false;
  documentState.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(1);
  documentState.hidden = true;
  documentState.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(20_000);
  expect(read).toHaveBeenCalledTimes(1);
  documentState.hidden = false;
  documentState.dispatchEvent(new Event("visibilitychange"));
  expect(read).toHaveBeenCalledTimes(2);
});

it("does not let a pre-hide read install another timer after showing again", async () => {
  let finish = () => {};
  const first = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const read = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
  dispose = observeServiceStatusPolling(read, () => 2000);
  documentState.hidden = true;
  documentState.dispatchEvent(new Event("visibilitychange"));
  documentState.hidden = false;
  documentState.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(1);
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(1);
});

it("uses the caller's updated retry delay and survives a rejected read", async () => {
  let delay = 4000;
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error("synthetic status failure"))
    .mockResolvedValue(undefined);
  dispose = observeServiceStatusPolling(read, () => delay);
  await vi.advanceTimersByTimeAsync(3999);
  expect(read).toHaveBeenCalledTimes(1);
  delay = 2000;
  await vi.advanceTimersByTimeAsync(1);
  expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000);
  expect(read).toHaveBeenCalledTimes(3);
});

it("releases visibility listeners and never reschedules after disposal", async () => {
  let finish = () => {};
  const read = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  dispose = observeServiceStatusPolling(read, () => 2000);
  dispose();
  finish();
  documentState.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
