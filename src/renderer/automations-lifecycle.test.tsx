import {
  type ComponentProps,
  type DependencyList,
  type EffectCallback,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ApplicationClient, AutomationSummary, AutomationUiRequest } from "../bridge/index.js";
import { AutomationForm } from "./automation-form.js";
import { AutomationHistory } from "./automation-history.js";
import { AutomationJob } from "./automation-job.js";
import { AutomationsPage } from "./automations.js";

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
// Supporting lifecycle integration only; focus/CSS/HTTP use the headless browser journeys.
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
        api: api as unknown as ApplicationClient,
        active,
        agents: [],
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
    required(tree, (node) => node.type === AutomationHistory).props.rows as {
      id: string;
    }[];
  dispose = () => {
    for (const slot of hooks.slots) slot.cleanup?.();
  };
  render();
  return { api, render, settle, job, history, tree: () => tree };
}

it.each([false, true])(
  "refreshes after a saved form only while the page is visible (hidden=%s)",
  async (hidden) => {
    const view = mount();
    await view.settle();
    const create = required(view.tree(), (node) => node.props.children === "New scheduled job");
    (create.props.onClick as () => void)();
    view.render();
    const saved = (
      required(view.tree(), (node) => node.type === AutomationForm).props as ComponentProps<
        typeof AutomationForm
      >
    ).onSaved;
    if (hidden) view.render(false);
    view.api.automation.mockClear();
    saved();
    await view.settle();
    if (hidden) expect(view.api.automation).not.toHaveBeenCalled();
    else expect(view.api.automation).toHaveBeenCalledWith({ action: "list" });
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
    view.job("b").onHistory();
    view.render();
    await view.settle();
    if (hidden) view.render(false);
    reject(new Error("Synthetic run rejection"));
    await action;
    await view.settle();
    const alert = find(view.tree(), (node) => node.props.kind === "error");
    expect(alert?.props.subtitle).toBe(hidden ? undefined : "Synthetic run rejection");
    if (!hidden) {
      const all = required(view.tree(), (node) => node.props.children === "Show all schedules");
      (all.props.onClick as () => void)();
      view.render();
      await view.settle();
      expect(view.job("b").open).toBe(true);
      expect(view.history()).toEqual([{ id: "all" }]);
      expect(find(view.tree(), (node) => node.props.kind === "error")?.props.subtitle).toBe(
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
  expect(view.history()).toEqual([{ id: "all" }]);
  view.job("b").onHistory();
  await view.settle();
  expect(view.history()).toEqual([{ id: "b" }]);
  const all = required(view.tree(), (node) => node.props.children === "Show all schedules");
  (all.props.onClick as () => void)();
  view.render();
  await view.settle();
  expect(view.job("b").open).toBe(true);
  expect(view.history()).toEqual([{ id: "all" }]);
});

it("keeps Older/Latest cursors bound to the selected job and clears the cursor for all schedules", async () => {
  const view = mount();
  await view.settle();
  view.api.automation.mockImplementation((request) =>
    request.action === "history"
      ? Promise.resolve(
          request.before
            ? [{ id: "older", sequence: 50 }]
            : Array.from({ length: 50 }, (_, index) => ({
                id: `execution-${index}`,
                sequence: 100 - index,
              })),
        )
      : reply(request),
  );
  view.job("a").onToggle();
  view.job("a").onHistory();
  view.render();
  await view.settle();
  const click = (label: string) => {
    const button = required(view.tree(), (node) => node.props.children === label);
    (button.props.onClick as () => void)();
    view.render();
  };
  click("Older");
  await view.settle();
  expect(view.api.automation).toHaveBeenCalledWith({ action: "history", id: "a", before: 51 });
  expect(view.history()).toEqual([{ id: "older", sequence: 50 }]);
  click("Latest");
  await view.settle();
  expect(view.history()).toHaveLength(50);
  click("Older");
  await view.settle();
  click("Show all schedules");
  await view.settle();
  expect(view.api.automation).toHaveBeenLastCalledWith({ action: "history" });
  expect(view.job("a").open).toBe(true);
});

it("rejects an old history response and refreshes the newly selected scope after its flight settles", async () => {
  const view = mount();
  await view.settle();
  let finish!: (value: unknown) => void;
  const delayed = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  view.api.automation.mockImplementation((request) =>
    request.action === "history" && request.id === "a" ? delayed : reply(request),
  );
  view.job("a").onToggle();
  view.job("a").onHistory();
  view.render();
  view.job("b").onHistory();
  view.render();
  finish([{ id: "stale-a" }]);
  await view.settle();
  expect(view.history()).toEqual([{ id: "b" }]);
});

it("keeps saved history visible and reports scheduler failure when Refresh fails", async () => {
  const view = mount();
  await view.settle();
  view.api.automation.mockRejectedValue(new Error("Synthetic scheduler unavailable"));
  const refresh = required(view.tree(), (node) => node.props.children === "Refresh");
  (refresh.props.onClick as () => void)();
  view.render();
  await view.settle();
  expect(find(view.tree(), (node) => node.props.kind === "error")?.props.subtitle).toContain(
    "Scheduler unavailable",
  );
  expect(view.history()).toEqual([{ id: "all" }]);
});

it("distinguishes the initial read from empty history and lets Retry recover the service", async () => {
  const view = mount();
  expect(
    find(view.tree(), (node) => node.props.description === "Reading scheduled jobs…"),
  ).toBeDefined();
  expect(find(view.tree(), (node) => node.type === AutomationHistory)?.props.showEmpty).toBe(false);
  await view.settle();
  view.api.automation.mockRejectedValue(new Error("Service unavailable"));
  (
    required(view.tree(), (node) => node.props.children === "Refresh").props.onClick as () => void
  )();
  await view.settle();
  expect(find(view.tree(), (node) => node.type === AutomationHistory)?.props.showEmpty).toBe(false);
  view.api.automation.mockImplementation(reply);
  (required(view.tree(), (node) => node.props.children === "Retry").props.onClick as () => void)();
  await view.settle();
  expect(find(view.tree(), (node) => node.props.kind === "error")).toBeUndefined();
  expect(view.history()).toEqual([{ id: "all" }]);
});
