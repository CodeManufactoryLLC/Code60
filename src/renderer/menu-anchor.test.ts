import { afterEach, expect, it, vi } from "vitest";
import { clampMenuPosition } from "./menu-anchor.js";

afterEach(() => vi.unstubAllGlobals());

it("keeps anchored menus and popovers inside the viewport, including oversized surfaces", () => {
  vi.stubGlobal("innerWidth", 800);
  vi.stubGlobal("innerHeight", 600);
  expect(clampMenuPosition(200, 100, { width: 240, height: 300 })).toEqual({ left: 200, top: 100 });
  expect(clampMenuPosition(790, 590, { width: 240, height: 300 })).toEqual({ left: 552, top: 292 });
  expect(clampMenuPosition(-40, -30, { width: 900, height: 700 })).toEqual({ left: 8, top: 8 });
});
