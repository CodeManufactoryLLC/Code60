import { expect, it } from "vitest";
import { parseSidebarBackdrop } from "./sidebar-backdrop.js";

it("accepts only bounded sidebar geometry, strength and visibility", () => {
  expect(parseSidebarBackdrop({ width: 244.5, strength: 70, visible: true })).toEqual({
    width: 244.5,
    strength: 70,
    visible: true,
  });
  for (const request of [
    { width: -1, strength: 50, visible: true },
    { width: 16385, strength: 50, visible: true },
    { width: Infinity, strength: 50, visible: true },
    { width: 244, strength: 101, visible: true },
    { width: 244, strength: 2.5, visible: true },
    { width: 244, strength: 50, visible: "true" },
    { width: 244, strength: 50, visible: true, windowId: 7 },
    { width: 244, strength: 50, visible: true, x: 0 },
  ])
    expect(() => parseSidebarBackdrop(request)).toThrow();
});
