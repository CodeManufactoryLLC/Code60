import { afterEach, expect, it, vi } from "vitest";
import { clampMenuPosition, scrollMenuOption } from "./menu-anchor.js";

afterEach(() => vi.unstubAllGlobals());

it("keeps anchored menus and popovers inside the viewport, including oversized surfaces", () => {
  vi.stubGlobal("innerWidth", 800);
  vi.stubGlobal("innerHeight", 600);
  expect(clampMenuPosition(200, 100, { width: 240, height: 300 })).toEqual({ left: 200, top: 100 });
  expect(clampMenuPosition(790, 590, { width: 240, height: 300 })).toEqual({ left: 552, top: 292 });
  expect(clampMenuPosition(-40, -30, { width: 900, height: 700 })).toEqual({ left: 8, top: 8 });
});

function scrollingOption(top: number, bottom: number, scale = 1) {
  const list = {
    scrollTop: 50,
    clientTop: 0,
    clientHeight: 100,
    offsetHeight: 100,
    getBoundingClientRect: () => ({ top: 20, height: 100 * scale }),
  };
  const option = {
    getBoundingClientRect: () => ({ top, bottom }),
    scrollIntoView: vi.fn(),
  };
  scrollMenuOption(list as unknown as HTMLElement, option as unknown as HTMLElement);
  expect(option.scrollIntoView).not.toHaveBeenCalled();
  return list.scrollTop;
}

it("scrolls only the dropdown list for options above, below or already in view", () => {
  expect(scrollingOption(150, 180)).toBe(110);
  expect(scrollingOption(0, 10)).toBe(30);
  expect(scrollingOption(40, 80)).toBe(50);
});

it("accounts for popover entrance scaling and oversized options without moving ancestors", () => {
  expect(scrollingOption(85, 100, 0.5)).toBe(110);
  expect(scrollingOption(40, 200)).toBe(70);
  expect(scrollingOption(0, 150)).toBe(50);
});

it("does not scroll a hidden list or read its option geometry", () => {
  const list = {
    scrollTop: 50,
    offsetHeight: 0,
    clientHeight: 0,
    getBoundingClientRect: () => ({ top: 20, height: 0 }),
  };
  const option = { getBoundingClientRect: vi.fn() };
  scrollMenuOption(list as unknown as HTMLElement, option as unknown as HTMLElement);
  expect(list.scrollTop).toBe(50);
  expect(option.getBoundingClientRect).not.toHaveBeenCalled();
});
