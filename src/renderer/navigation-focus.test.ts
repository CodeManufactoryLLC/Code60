import { expect, it, vi } from "vitest";
import { focusNavigation } from "./navigation-focus.js";

it("focuses after layout effects reveal an inert destination", async () => {
  let inert = true;
  let focused = false;
  const focus = vi.fn(() => {
    if (!inert) focused = true;
  });
  const getElementById = vi.fn(() => ({ focus }) as unknown as HTMLElement);
  focusNavigation("conversation-worker", { activeElement: null, getElementById });
  expect(focus).not.toHaveBeenCalled();
  inert = false;
  await Promise.resolve();
  expect(focused).toBe(true);
  expect(getElementById).toHaveBeenCalledExactlyOnceWith("conversation-worker");
});

it("cancels stale navigation and preserves an opened menu or dialog", async () => {
  const getElementById = vi.fn();
  const cancel = focusNavigation("old", { activeElement: null, getElementById });
  cancel();
  await Promise.resolve();
  expect(getElementById).not.toHaveBeenCalled();
  const closest = vi.fn(() => ({}));
  focusNavigation("new", {
    activeElement: { closest } as unknown as Element,
    getElementById,
  });
  await Promise.resolve();
  expect(closest).toHaveBeenCalledWith('dialog[open], [role="menu"]');
  expect(getElementById).not.toHaveBeenCalled();
});
