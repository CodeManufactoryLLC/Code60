import { afterEach, expect, it, vi } from "vitest";
import { observeBreadcrumbRightInset } from "./page-title-header.js";

afterEach(() => vi.unstubAllGlobals());

it("tracks the right panel divider, restores stacked/closed width and releases queued resize work", () => {
  let resized = () => {};
  const disconnect = vi.fn();
  const observe = vi.fn();
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
  let conversationRight = 800;
  let headerPresent = true;
  let cardHeight = 58;
  const values = new Map<string, string>();
  const conversations = { getBoundingClientRect: () => ({ right: conversationRight }) };
  const header = { getBoundingClientRect: () => ({ right: 1000, width: 900 }) };
  const workspace = {
    querySelector: (selector: string) =>
      headerPresent
        ? selector === ".workspace-breadcrumbs"
          ? { getBoundingClientRect: () => ({ top: 40, height: cardHeight }) }
          : header
        : null,
    style: {
      getPropertyValue: (name: string) => values.get(name) ?? "",
      setProperty: vi.fn((name: string, value: string) => values.set(name, value)),
      removeProperty: (name: string) => values.delete(name),
    },
  };
  let bodyTop = 170;
  const body = {
    closest: () => workspace,
    querySelector: () => conversations,
    getBoundingClientRect: () => ({ top: bodyTop }),
  };
  const stop = observeBreadcrumbRightInset(body as unknown as HTMLElement);
  expect(values.get("--breadcrumb-right-inset")).toBe("200px");
  expect(observe.mock.calls.map(([element]) => element)).toEqual([
    conversations,
    workspace,
    header,
  ]);
  expect(values.get("--right-panel-rise")).toBe("130px");
  resized();
  expect(workspace.style.setProperty).toHaveBeenCalledTimes(3);
  expect(values.get("--breadcrumb-card-height")).toBe("58px");
  cardHeight = 72;
  resized();
  expect(values.get("--breadcrumb-card-height")).toBe("72px");
  bodyTop = 190;
  resized();
  expect(values.get("--right-panel-rise")).toBe("150px");
  conversationRight = 650;
  resized();
  expect(values.get("--breadcrumb-right-inset")).toBe("350px");
  conversationRight = 984; // The stacked transcript retains its vertical scrollbar gutter.
  resized();
  expect(values.get("--right-panel-rise")).toBe("150px");
  expect(values.get("--breadcrumb-right-inset")).toBe("16px");
  conversationRight = 650;
  resized();
  expect(values.get("--breadcrumb-right-inset")).toBe("350px");
  conversationRight = 1000;
  resized();
  expect(values.get("--breadcrumb-right-inset")).toBe("0px");
  headerPresent = false;
  conversationRight = 650;
  resized();
  expect(values.get("--breadcrumb-right-inset")).toBe("0px");
  stop();
  expect(disconnect).toHaveBeenCalledOnce();
  headerPresent = true;
  resized();
  expect(values.has("--breadcrumb-right-inset")).toBe(false);
  expect(values.has("--right-panel-rise")).toBe(false);
  expect(values.has("--breadcrumb-card-height")).toBe(false);
});

it.each(["workspace", "conversations"])(
  "ignores a missing %s when no chat layout is mounted",
  (missing) => {
    const body = {
      closest: () => (missing === "workspace" ? null : {}),
      querySelector: () => null,
    };
    expect(observeBreadcrumbRightInset(body as unknown as HTMLElement)).toBeTypeOf("function");
  },
);
