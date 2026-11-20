import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { DesktopApi, LogPage } from "../bridge/index.js";
import { LogsPage } from "./logs.js";
import { defaultTextStyles } from "./typography.js";

const forwarded = vi.hoisted(() => ({ options: {} as Record<string, unknown> }));
// The desktop is client-only; use its initial snapshot for this static toolbar test.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useSyncExternalStore: (...args: Parameters<typeof actual.useSyncExternalStore>) =>
      actual.useSyncExternalStore(args[0], args[1], args[2] ?? args[1]),
  };
});
vi.mock("./data-table.js", () => ({
  DataTable: (options: Record<string, unknown>) => {
    forwarded.options = options;
    return createElement("section", null, options.actions as ReactElement);
  },
}));
afterEach(() => vi.unstubAllGlobals());

it("offers private app-wide diagnostics without a database and wires explicit refresh to the narrow API", async () => {
  const page: LogPage = {
    records: [],
    cursor: null,
    state: "ready",
    appLaunchId: crypto.randomUUID(),
    status: { unavailable: false, malformed: 0, dropped: 0, persistenceFailures: 0 },
  };
  const queryLogs = vi.fn().mockResolvedValue(page);
  const markup = renderToStaticMarkup(
    <LogsPage
      api={{ queryLogs } as unknown as DesktopApi}
      active
      project={null}
      lines={{ horizontal: false, vertical: false, heading: false }}
      density="high"
      fit
      textStyles={defaultTextStyles}
    />,
  );
  expect(markup).toContain('aria-label="Logs"');
  expect(markup).not.toContain("7 days and 20 MiB");
  expect(markup).toContain("Pause viewing");
  expect(markup).toContain("Refresh logs");
  expect(markup).toContain("Clear logs");
  expect(forwarded.options.tableId).toBe("logs");
  expect(forwarded.options.workspace).toBe("app-diagnostics");
  expect(forwarded.options.onRetainedQuery).toBeTypeOf("function");
  expect(queryLogs).not.toHaveBeenCalled();
  const actions = forwarded.options.actions as ReactElement<{
    children: ReactElement<{ onClick(): void }>[];
  }>;
  const frame = vi.fn((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("requestAnimationFrame", frame);
  actions.props.children[1]?.props.onClick();
  await vi.waitFor(() => expect(frame).toHaveBeenCalledOnce());
  expect(queryLogs).toHaveBeenCalledOnce();
  expect(queryLogs).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
});
