import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { DesktopApi, MemoryRecord } from "../bridge/index.js";
import { MemoriesPage } from "./memories.js";
import { defaultTextStyles } from "./typography.js";

const forwarded = vi.hoisted(() => ({ options: {} as Record<string, unknown> }));
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
    return createElement(
      "section",
      null,
      options.scope as ReactElement,
      options.actions as ReactElement,
    );
  },
}));
it("uses an application-scoped shared table with bounded paging and labelled filters", () => {
  const browseMemories = vi.fn();
  const html = renderToStaticMarkup(
    <MemoriesPage
      api={{ browseMemories } as unknown as DesktopApi}
      active={false}
      lines={{ horizontal: false, vertical: false, heading: false }}
      density="high"
      fit
      textStyles={defaultTextStyles}
    />,
  );
  expect(html).toContain('aria-label="Memories"');
  expect(html).toContain('aria-label="Memory project"');
  expect(html).toContain('aria-label="Memory type"');
  expect(html).toContain('aria-label="Memory status"');
  expect(html).not.toContain("apply to this page");
  expect(html).toContain("No memories in this view.");
  expect(html).toContain("Previous page");
  expect(html).toContain("Next page");
  expect(html).toContain("Refresh memories");
  expect(forwarded.options.tableId).toBe("memories");
  expect(forwarded.options.workspace).toBe("application-memory");
  expect(forwarded.options.initialSort).toBe("createdAt");
  expect(forwarded.options.onSelect).toBeTypeOf("function");
  expect(forwarded.options.rows).toEqual([]);
  expect(browseMemories).not.toHaveBeenCalled();
  const columns = forwarded.options.columns as { key: string; filter: string }[];
  expect(columns.map((c) => c.key)).toContain("conversationId");
  expect(columns.every((c) => !!c.filter)).toBe(true);
  const display = forwarded.options.display as (
    record: Partial<MemoryRecord>,
    key: keyof MemoryRecord,
  ) => string;
  expect(display({ text: "<script>literal</script>" }, "text")).toBe("<script>literal</script>");
  expect(display({ pinned: true }, "pinned")).toBe("Yes");
  expect(display({ pinned: false }, "pinned")).toBe("No");
  expect(display({ lastUsedAt: null }, "lastUsedAt")).toBe("Never");
  expect(display({ projectId: null }, "projectId")).toBe("None");
  expect(display({ revision: 4 }, "revision")).toBe("4");
  expect(display({ eventAt: "invalid" }, "eventAt")).toBe("Unknown");
  const timestamp = "2026-01-01T00:00:00.000Z";
  expect(display({ createdAt: timestamp }, "createdAt")).toBe(
    new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" }).format(
      new Date(timestamp),
    ),
  );
});
