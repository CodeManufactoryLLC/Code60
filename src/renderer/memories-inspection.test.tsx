import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { DesktopApi, MemoryDetail } from "../bridge/index.js";
import { DataTable } from "./data-table.js";
import { MemoriesPage } from "./memories.js";
import { MemoryInspector } from "./memory.js";
import { Modal } from "./modal.js";
import { defaultTextStyles } from "./typography.js";

const hooks = vi.hoisted(() => ({ index: 0, values: [] as unknown[] }));
// Supporting component-state checks; real DOM/focus/layout is covered by desktop journeys.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values))
      hooks.values[index] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.values[index],
      (value: unknown) => {
        hooks.values[index] = value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    hooks.values[index] ??= { current: initial };
    return hooks.values[index];
  },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useEffect: () => {},
}));

function nodes(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(tree).flatMap((node) =>
    isValidElement<Record<string, unknown>>(node)
      ? [node, ...nodes(node.props.children as ReactNode)]
      : [],
  );
}
const detail = { record: { id: "saved", revision: 1 } } as MemoryDetail;
function deferred() {
  let resolve!: (value: MemoryDetail) => void;
  const promise = new Promise<MemoryDetail>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
const api = { memoryDetail: vi.fn(), memoryAction: vi.fn() };
function render() {
  hooks.index = 0;
  return MemoriesPage({
    api: api as unknown as DesktopApi,
    active: true,
    lines: { horizontal: false, vertical: false, heading: false },
    density: "high",
    fit: true,
    textStyles: defaultTextStyles,
  });
}
function select(id = "saved") {
  const table = nodes(render()).find((node) => node.type === DataTable);
  if (!table) throw new Error("Table missing");
  (table.props.onSelect as (id: string) => void)(id);
}
function close() {
  const modal = nodes(render()).find((node) => node.type === Modal);
  if (!modal) throw new Error("Dialog missing");
  (modal.props.onClose as () => void)();
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
beforeEach(() => {
  hooks.index = 0;
  hooks.values = [];
  api.memoryDetail.mockReset();
  api.memoryAction.mockReset();
});

it("opens loading immediately, exposes a safe failure and retries the same saved record", async () => {
  const pending = deferred();
  api.memoryDetail.mockReturnValueOnce(pending.promise);
  select();
  expect(nodes(render()).some((node) => node.props.children === "Loading memory details…")).toBe(
    true,
  );
  pending.resolve(detail);
  await settle();
  expect(nodes(render()).find((node) => node.type === MemoryInspector)?.props.detail).toBe(detail);
  close();
  api.memoryDetail.mockRejectedValueOnce(new Error("private storage detail"));
  select();
  await settle();
  const failed = nodes(render());
  expect(
    failed.some((node) => String(node.props.children).includes("private storage detail")),
  ).toBe(false);
  expect(
    failed.some(
      (node) =>
        node.props.children ===
        "Memory details are unavailable. The record may have changed or been forgotten.",
    ),
  ).toBe(true);
  api.memoryDetail.mockResolvedValueOnce(detail);
  const retry = failed.find(
    (node) => node.type === "button" && node.props.children === "Retry memory details",
  );
  if (!retry) throw new Error("Retry missing");
  (retry.props.onClick as () => void)();
  await settle();
  expect(api.memoryDetail).toHaveBeenLastCalledWith({ id: "saved" });
  expect(nodes(render()).find((node) => node.type === MemoryInspector)?.props.detail).toBe(detail);
});

it("discards details that arrive after dismissal or a newer selection", async () => {
  const dismissed = deferred();
  api.memoryDetail.mockReturnValueOnce(dismissed.promise);
  select();
  close();
  dismissed.resolve(detail);
  await settle();
  expect(nodes(render()).some((node) => node.type === Modal)).toBe(false);
  const old = deferred();
  api.memoryDetail.mockReturnValueOnce(old.promise).mockResolvedValueOnce(detail);
  select("old");
  select();
  await settle();
  old.resolve({ ...detail, record: { ...detail.record, id: "old" } });
  await settle();
  expect(nodes(render()).find((node) => node.type === MemoryInspector)?.props.detail).toBe(detail);
});
