import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ApplicationClient } from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
import { MemoryRecall, RecallGroup } from "./memory-recall.js";
import type { RecallTurn } from "./memory-recall-history.js";

const hooks = vi.hoisted(() => ({ index: 0, values: [] as unknown[] }));
// Supporting component-state checks, not DOM or desktop workflow evidence.
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
  useMemo: (compute: () => unknown) => compute(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useEffect: () => {},
  useLayoutEffect: () => {},
}));

const at = "2026-11-15T12:00:00.000Z";
const id = "66ac0785-44b0-4cbd-9f5e-d85048c1ba11";
const prompt = (turn: number): RunEvent => ({
  type: "prompt",
  runId: "run",
  at,
  turn,
  text: "task",
});
const events = (count: number): RunEvent[] =>
  Array.from({ length: count }, (_, index) => [
    prompt(index + 1),
    {
      type: "note",
      runId: "run",
      at,
      text: "Memory used (1). Inspect Data Viewer → Memories for sources.",
      detail: JSON.stringify([id]),
    } as RunEvent,
  ]).flat();
const api = {} as ApplicationClient;
function render(events: RunEvent[]) {
  hooks.index = 0;
  return MemoryRecall({ api, source: { owner: "owner", runId: "run", events } });
}
function groups(tree: ReturnType<typeof render>) {
  return Children.toArray(tree.props.children).filter(
    (node): node is ReactElement<{ turn: RecallTurn }> =>
      isValidElement<{ turn: RecallTurn }>(node) && node.type === RecallGroup,
  );
}
function click(tree: ReactNode, label: string): boolean {
  for (const node of Children.toArray(tree)) {
    if (!isValidElement<{ children?: ReactNode; onClick?(): void }>(node)) continue;
    if (node.type === "button" && node.props.children === label) {
      node.props.onClick?.();
      return true;
    }
    if (click(node.props.children, label)) return true;
  }
  return false;
}
beforeEach(() => {
  hooks.values = [];
  hooks.index = 0;
});

it.each([1, 2])("follows new dispatched turns after returning from %i older pages", (pages) => {
  const history = events(12);
  let tree = render(history);
  for (let page = 0; page < pages; page++) {
    expect(click(tree, "Older turns")).toBe(true);
    tree = render(history);
  }
  expect(groups(tree)[0]?.props.turn.turn).toBe(12 - pages * 5);
  for (let page = 0; page < pages; page++) {
    expect(click(tree, "Newer turns")).toBe(true);
    tree = render(history);
  }
  expect(groups(tree)[0]?.props.turn.turn).toBe(12);
  tree = render([...history, prompt(13)]);
  expect(groups(tree)[0]?.props.turn).toMatchObject({ turn: 13, current: true, ids: [] });
});

it("preserves the older-page anchor and surviving group identity after event-window eviction", () => {
  const history = events(20);
  let tree = render(history);
  expect(click(tree, "Older turns")).toBe(true);
  tree = render(history);
  const previous = groups(tree);
  expect(previous.map((group) => group.props.turn.turn)).toEqual([15, 14, 13, 12, 11]);
  tree = render(history.slice(4));
  expect(groups(tree).map((group) => group.props.turn.turn)).toEqual([15, 14, 13, 12, 11]);
  expect(groups(tree).map((group) => group.key)).toEqual(previous.map((group) => group.key));
});
