import { expect, it, vi } from "vitest";
import { parseWindowControl } from "../bridge/index.js";
import { controlWindow } from "./window-controls.js";

it("validates caption actions and preserves the normal close path", () => {
  const window = {
    isMaximized: vi.fn(() => false),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    minimize: vi.fn(),
    close: vi.fn(),
  };
  controlWindow(window, parseWindowControl("minimize"));
  expect(window.minimize).toHaveBeenCalledOnce();
  controlWindow(window, parseWindowControl("maximize"));
  expect(window.maximize).toHaveBeenCalledOnce();
  window.isMaximized.mockReturnValue(true);
  controlWindow(window, parseWindowControl("maximize"));
  expect(window.unmaximize).toHaveBeenCalledOnce();
  controlWindow(window, parseWindowControl("close"));
  expect(window.close).toHaveBeenCalledOnce();
  for (const value of ["destroy", {}, { action: "close", id: 42 }, null])
    expect(() => parseWindowControl(value)).toThrow();
});
