import { afterEach, expect, it, vi } from "vitest";
import { observeWorkspaceInset } from "./sidebar-layout.js";

afterEach(() => vi.unstubAllGlobals());

it.each([28, 67.5])("doubles the measured Home clearance, including notices (%s)", (initialTop) => {
  let top = initialTop;
  let resized = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const properties = new Map<string, string>();
  const strip = {};
  const notice = {} as Element;
  const app = { getBoundingClientRect: () => ({ top: 4 }), querySelector: () => strip };
  const workspace = {
    parentElement: app,
    getBoundingClientRect: () => ({ top: top + 4 }),
    style: {
      getPropertyValue: (key: string) => properties.get(key) ?? "",
      setProperty: vi.fn((key: string, value: string) => properties.set(key, value)),
      removeProperty: vi.fn((key: string) => properties.delete(key)),
    },
  };
  const stop = observeWorkspaceInset(workspace as unknown as HTMLElement, notice);
  expect(properties.get("--workspace-top-inset")).toBe(`${initialTop}px`);
  expect(top + Number.parseFloat(properties.get("--workspace-top-inset") ?? "")).toBe(
    initialTop * 2,
  );
  expect(observe.mock.calls.map(([element]) => element)).toEqual([workspace, app, strip, notice]);
  resized();
  expect(workspace.style.setProperty).toHaveBeenCalledOnce();
  top = 93;
  resized();
  expect(properties.get("--workspace-top-inset")).toBe("93px");
  stop();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(properties.has("--workspace-top-inset")).toBe(false);
});
