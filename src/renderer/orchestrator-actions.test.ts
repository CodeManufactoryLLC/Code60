import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ApplicationClient } from "../bridge/index.js";
import { bindDatabaseWrites } from "./database-api.js";
import { useOrchestratorActions } from "./orchestrator-actions.js";

const hooks = vi.hoisted(() => ({
  memo: undefined as unknown,
  memoDeps: undefined as readonly unknown[] | undefined,
  effectDeps: undefined as readonly unknown[] | undefined,
  cleanup: undefined as (() => void) | undefined,
}));
const changed = (before: readonly unknown[] | undefined, after: readonly unknown[]) =>
  !before ||
  before.length !== after.length ||
  after.some((value, i) => !Object.is(value, before[i]));

// Supporting hook-lifetime checks. Desktop CI exercises the real React/IPC send path.
vi.mock("react", () => ({
  useMemo: (compute: () => unknown, dependencies: readonly unknown[]) => {
    if (changed(hooks.memoDeps, dependencies)) hooks.memo = compute();
    hooks.memoDeps = dependencies;
    return hooks.memo;
  },
  useEffect: (effect: () => () => void, dependencies: readonly unknown[]) => {
    if (changed(hooks.effectDeps, dependencies)) {
      hooks.cleanup?.();
      hooks.cleanup = effect();
    }
    hooks.effectDeps = dependencies;
  },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
beforeEach(() => {
  hooks.memoDeps = undefined;
  hooks.effectDeps = undefined;
});
afterEach(() => {
  hooks.cleanup?.();
  hooks.cleanup = undefined;
});

it.each([true, false])(
  "keeps a pending send across database wrapper changes only for application owners (%s)",
  async (applicationOwned) => {
    let finish!: () => void;
    const orchestrationChatAction = vi.fn(
      () =>
        new Promise<undefined>((resolve) => {
          finish = () => resolve(undefined);
        }),
    );
    const api = { orchestrationChatAction } as unknown as ApplicationClient;
    const first = useOrchestratorActions(
      bindDatabaseWrites(api, 1),
      "/a",
      "chat",
      applicationOwned,
    );
    const sent = first.action({ type: "send", id: "run", text: "request" });
    const second = useOrchestratorActions(
      bindDatabaseWrites(api, 2),
      "/b",
      "chat",
      applicationOwned,
    );
    expect(second.action === first.action).toBe(applicationOwned);
    expect(second.pending).toBe(applicationOwned ? "send" : null);
    finish();
    expect(await sent).toBe(applicationOwned);
    expect(orchestrationChatAction).toHaveBeenCalledExactlyOnceWith({
      type: "send",
      id: "run",
      text: "request",
    });
  },
);

it("still rejects late results after conversation or transport replacement", async () => {
  let finish!: () => void;
  const api = {
    orchestrationChatAction: () =>
      new Promise<undefined>((resolve) => {
        finish = () => resolve(undefined);
      }),
  } as unknown as ApplicationClient;
  const first = useOrchestratorActions(api, null, "a", true);
  const sent = first.action({ type: "send", id: "run-a", text: "request" });
  const second = useOrchestratorActions(api, null, "b", true);
  expect(second.action).not.toBe(first.action);
  finish();
  expect(await sent).toBe(false);
  const pending = second.action({ type: "send", id: "run-b", text: "request" });
  const third = useOrchestratorActions(
    { ...api, orchestrationChatAction: vi.fn(async () => undefined) },
    null,
    "b",
    true,
  );
  expect(third.action).not.toBe(second.action);
  finish();
  expect(await pending).toBe(false);
});
