import {
  type ComponentProps,
  type DependencyList,
  type EffectCallback,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AutomationSummary, AutomationUiRequest, DesktopApi } from "../bridge/index.js";
import { AutomationForm } from "./automation-form.js";
import { AutomationJob } from "./automation-job.js";
import { AutomationsPage } from "./automations.js";
import { defaultTextStyles } from "./typography.js";

type Slot = {
  value?: unknown;
  dependencies?: DependencyList | undefined;
  cleanup?: (() => void) | undefined;
};
type Hooks = { slots: Slot[]; index: number; dirty: boolean; effects: (() => void)[] };
const current = vi.hoisted(() => ({ hooks: undefined as Hooks | undefined }));
const next = () => {
  const hooks = current.hooks;
  if (!hooks) throw new Error("Missing hook scope");
  const index = hooks.index++;
  hooks.slots[index] ??= {};
  return { hooks, slot: hooks.slots[index] };
};
const changed = (before: DependencyList | undefined, after: DependencyList | undefined) =>
  !before ||
  !after ||
  before.length !== after.length ||
  after.some((value, i) => !Object.is(value, before[i]));
const memo = (compute: () => unknown, dependencies: DependencyList) => {
  const { slot } = next();
  if (changed(slot.dependencies, dependencies)) slot.value = compute();
  slot.dependencies = dependencies;
  return slot.value;
};
function effect(run: EffectCallback, dependencies?: DependencyList) {
  const { hooks, slot } = next();
  if (changed(slot.dependencies, dependencies))
    hooks.effects.push(() => {
      slot.cleanup?.();
      const cleanup = run();
      slot.cleanup =
        typeof cleanup === "function"
          ? () => {
              cleanup();
            }
          : undefined;
    });
  slot.dependencies = dependencies;
}
// Supporting lifecycle integration only; native focus/CSS/IPC use the Docker journeys.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const { hooks, slot } = next();
    if (!Object.hasOwn(slot, "value"))
      slot.value = typeof initial === "function" ? initial() : initial;
    return [
      slot.value,
      (update: unknown) => {
        const value = typeof update === "function" ? update(slot.value) : update;
        if (!Object.is(value, slot.value)) {
          slot.value = value;
          hooks.dirty = true;
        }
      },
    ];
  },
  useRef: (value: unknown) => {
    const { slot } = next();
    slot.value ??= { current: value };
    return slot.value;
  },
  useCallback: (value: unknown, dependencies: DependencyList) => memo(() => value, dependencies),
  useLayoutEffect: effect,
  useEffect: effect,
}));
vi.mock("./data-table.js", () => ({ DataTable: () => null }));
type Element = ReactElement<Record<string, unknown>>;
function find(tree: ReactNode, match: (node: Element) => boolean): Element | undefined {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = find(child, match);
      if (found) return found;
    }
  }
  if (!isValidElement<Record<string, unknown>>(tree)) return;
  return match(tree) ? tree : find(tree.props.children as ReactNode, match);
}
function required(tree: ReactNode, match: (node: Element) => boolean): Element {
  const found = find(tree, match);
  if (!found) throw new Error("Missing fixture control");
  return found;
}
const jobs = ["a", "b"].map((id) => ({
  id,
  name: id,
  revision: 1,
  agent: "fake",
  enabled: false,
  nextRunAt: null,
  running: false,
})) satisfies AutomationSummary[];
const reply = (request: AutomationUiRequest): Promise<unknown> =>
  Promise.resolve(
    request.action === "list"
      ? jobs
      : request.action === "history"
        ? [{ id: request.id ?? "all" }]
        : null,
  );
let dispose = () => {};
beforeEach(() => vi.stubGlobal("document", Object.assign(new EventTarget(), { hidden: false })));
afterEach(() => {
  dispose();
  vi.unstubAllGlobals();
});
function mount() {
  const api = { automation: vi.fn(reply), onAutomationChanged: vi.fn(() => () => {}) };
  const hooks: Hooks = { slots: [], index: 0, dirty: false, effects: [] };
  let active = true;
  let tree: ReactNode;
  const render = (visible = active) => {
    active = visible;
    for (let pass = 0; pass < 20; pass++) {
      hooks.index = 0;
      hooks.dirty = false;
      hooks.effects = [];
      current.hooks = hooks;
      tree = AutomationsPage({
        api: api as unknown as DesktopApi,
        active,
        agents: [],
        lines: { horizontal: false, vertical: false, heading: false },
        density: "high",
        fit: true,
        textStyles: defaultTextStyles,
      });
      for (const run of hooks.effects) run();
      if (!hooks.dirty) return;
    }
    throw new Error("Unsettled fixture");
  };
  const settle = async () => {
    for (let pass = 0; pass < 3; pass++) {
      for (let turn = 0; turn < 8; turn++) await Promise.resolve();
      render();
    }
  };
  const job = (id: string) =>
    required(
      tree,
      (node) => node.type === AutomationJob && (node.props.job as AutomationSummary).id === id,
    ).props as ComponentProps<typeof AutomationJob>;
  const history = () =>
    required(tree, (node) => node.props.tableId === "automation-history").props.rows as {
      id: string;
    }[];
  dispose = () => {
    for (const slot of hooks.slots) slot.cleanup?.();
  };
  render();
  return { api, render, settle, job, history, tree: () => tree };
}

it.each(["job", "creation"] as const)(
  "refreshes the current history scope after a retained %s save and performs no hidden reads",
  async (origin) => {
    for (const hidden of [false, true]) {
      const view = mount();
      await view.settle();
      view.job("a").onToggle();
      view.render();
      await view.settle();
      let saved = view.job("a").onSaved;
      if (origin === "creation") {
        const menu = required(view.tree(), (node) => node.props.label === "Actions");
        (menu.props.items as { run(): void }[])[0]?.run();
        view.render();
        saved = (
          required(view.tree(), (node) => node.type === AutomationForm).props as ComponentProps<
            typeof AutomationForm
          >
        ).onSaved;
      }
      view.job("b").onToggle();
      view.render();
      await view.settle();
      if (hidden) view.render(false);
      view.api.automation.mockClear();
      saved();
      await view.settle();
      if (hidden) expect(view.api.automation).not.toHaveBeenCalled();
      else
        expect(
          view.api.automation.mock.calls
            .filter(([request]) => request.action === "history")
            .map(([request]) => (request.action === "history" ? request.id : undefined)),
        ).toEqual(["b"]);
      expect(view.history()).toEqual([{ id: "b" }]);
      dispose();
    }
  },
);

it.each([false, true])(
  "keeps mutation failures owned by page visibility rather than history selection (hidden=%s)",
  async (hidden) => {
    const view = mount();
    await view.settle();
    let reject!: (error: Error) => void;
    const blocked = new Promise<unknown>((_resolve, fail) => {
      reject = fail;
    });
    view.api.automation.mockImplementation((request) =>
      request.action === "runNow" ? blocked : reply(request),
    );
    const action = view.job("a").onAction({ action: "runNow", id: "a" });
    view.render();
    view.job("b").onToggle();
    view.render();
    await view.settle();
    if (hidden) view.render(false);
    reject(new Error("Synthetic run rejection"));
    await action;
    await view.settle();
    const alert = find(view.tree(), (node) => node.props.role === "alert");
    expect(alert?.props.children).toBe(hidden ? undefined : "Synthetic run rejection");
    if (!hidden) {
      const all = required(
        view.tree(),
        (node) => node.type === "button" && node.props.children === "Show all schedules",
      );
      (all.props.onClick as () => void)();
      view.render();
      await view.settle();
      expect(view.job("b").open).toBe(true);
      expect(view.history()).toEqual([{ id: "all" }]);
      expect(find(view.tree(), (node) => node.props.role === "alert")?.props.children).toBe(
        "Synthetic run rejection",
      );
    }
  },
);

it("changes history scope without closing the expanded details", async () => {
  const view = mount();
  await view.settle();
  view.job("b").onToggle();
  view.render();
  await view.settle();
  const all = required(
    view.tree(),
    (node) => node.type === "button" && node.props.children === "Show all schedules",
  );
  (all.props.onClick as () => void)();
  view.render();
  await view.settle();
  expect(view.job("b").open).toBe(true);
  expect(view.history()).toEqual([{ id: "all" }]);
});
