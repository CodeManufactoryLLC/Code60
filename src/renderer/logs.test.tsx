import { createElement } from "react";
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
    return createElement("section");
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
  const actions = forwarded.options.pageActions as { label: string; run(): void }[];
  expect(actions.map((action) => action.label)).toEqual([
    "Pause viewing",
    "Refresh logs",
    "Clear logs",
  ]);
  expect(forwarded.options.tableId).toBe("logs");
  expect(forwarded.options.workspace).toBe("app-diagnostics");
  expect(forwarded.options.onRetainedQuery).toBeTypeOf("function");
  expect(queryLogs).not.toHaveBeenCalled();
  const frame = vi.fn((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("requestAnimationFrame", frame);
  actions[1]?.run();
  await vi.waitFor(() => expect(frame).toHaveBeenCalledOnce());
  expect(queryLogs).toHaveBeenCalledOnce();
  expect(queryLogs).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
});
