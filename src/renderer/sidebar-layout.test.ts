import { afterEach, expect, it, vi } from "vitest";
import { observeSidebarCardEdges, observeWorkspaceInset } from "./sidebar-layout.js";

afterEach(() => vi.unstubAllGlobals());

it("moves card edges through nested disclosure changes and disconnects on disposal", () => {
  let changed = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: () => void) {
        changed = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const row = (nested = false) => {
    const attributes = new Set<string>();
    return {
      attributes,
      hidden: false,
      parentElement: { closest: () => (nested ? {} : null) },
      closest() {
        return this.hidden ? {} : null;
      },
      setAttribute: (name: string) => attributes.add(name),
      removeAttribute: (name: string) => attributes.delete(name),
    };
  };
  const heading = row();
  const headingTab = row(true);
  const project = row();
  const worker = row();
  let rows = [heading, headingTab, project, worker];
  const marked = () => rows.filter((item) => item.attributes.size > 0);
  const card = {
    querySelectorAll: (selector: string) => (selector.startsWith("[data-") ? marked() : rows),
  };
  const sidebar = {
    querySelectorAll: (selector: string) =>
      selector === ".sidebar-navigation-card" ? [card] : marked(),
  };
  const stop = observeSidebarCardEdges(sidebar as unknown as HTMLElement);
  expect(heading.attributes).toEqual(new Set(["data-card-first"]));
  expect(headingTab.attributes.size).toBe(0);
  expect(project.attributes.size).toBe(0);
  expect(worker.attributes).toEqual(new Set(["data-card-last"]));
  worker.hidden = true;
  changed();
  expect(worker.attributes.size).toBe(0);
  expect(project.attributes).toEqual(new Set(["data-card-last"]));
  project.hidden = true;
  changed();
  expect(heading.attributes).toEqual(new Set(["data-card-first", "data-card-last"]));
  const replacement = row();
  rows = [heading, headingTab, replacement];
  changed();
  expect(heading.attributes).toEqual(new Set(["data-card-first"]));
  expect(replacement.attributes).toEqual(new Set(["data-card-last"]));
  expect(observe).toHaveBeenCalledWith(sidebar, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });
  stop();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(marked()).toEqual([]);
});

it.each([28, 67.5])(
  "reserves the measured preceding height for the content header, including notices (%s)",
  (initialTop) => {
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
  },
);
