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

it("preserves a search target already focused in the visible destination", async () => {
  const getElementById = vi.fn();
  const activeElement = {
    closest: (selector: string) => (selector === ".page-panel" ? {} : null),
  } as unknown as Element;
  focusNavigation("conversation-worker", { activeElement, getElementById });
  await Promise.resolve();
  expect(getElementById).not.toHaveBeenCalled();
});

it("does not steal focus from a later interaction", async () => {
  const root = { activeElement: null as Element | null, getElementById: vi.fn() };
  focusNavigation("conversation-worker", root);
  root.activeElement = {} as Element;
  await Promise.resolve();
  expect(root.getElementById).not.toHaveBeenCalled();
});

it("does not refocus an already focused sidebar destination and trigger scrolling", async () => {
  const focus = vi.fn();
  const activeElement = { focus, closest: () => null } as unknown as HTMLElement;
  focusNavigation("tab-home", { activeElement, getElementById: () => activeElement });
  await Promise.resolve();
  expect(focus).not.toHaveBeenCalled();
});

it("still focuses navigation after hiding the previous page drops focus to the body", async () => {
  const focus = vi.fn();
  const root = {
    activeElement: {} as Element,
    getElementById: vi.fn(() => ({ focus }) as unknown as HTMLElement),
  };
  focusNavigation("conversation-worker", root);
  root.activeElement = { tagName: "BODY", closest: () => null } as unknown as Element;
  await Promise.resolve();
  expect(focus).toHaveBeenCalledOnce();
});
