import type { EffectCallback, ReactElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { ApplicationClient, Snapshot } from "../bridge/index.js";
import { AgentSetupWizard } from "./agent-setup.js";

const hooks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  index: 0,
  effects: [] as EffectCallback[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (value: unknown) => {
    const index = hooks.index++;
    const existing = hooks.refs[index];
    if (existing) return existing;
    const ref = { current: value };
    hooks.refs[index] = ref;
    return ref;
  },
  useId: () => "provider-code-form",
  useState: (value: unknown) => [value, vi.fn()],
  useEffect: (effect: EffectCallback) => {
    hooks.effects.push(effect);
  },
  useCallback: (fn: unknown) => fn,
}));
afterEach(() => {
  hooks.refs = [];
  hooks.index = 0;
  hooks.effects = [];
});
it("begins once after a previously retiring session clears, without resurrecting a closing dialog", async () => {
  let release = () => {};
  const abandoned = new Promise<void>((resolve) => {
    release = resolve;
  });
  const begin = vi.fn(async () => {}),
    abandon = vi.fn(() => abandoned),
    close = vi.fn();
  const api = {
    beginAgentSetup: begin,
    abandonAgentSetup: abandon,
  } as unknown as ApplicationClient;
  const previous = {
    revision: 10,
    agentSetup: { session: { id: "previous", phase: "select", verified: [] }, providers: [] },
  } as unknown as Snapshot;
  const empty = { revision: 11, agentSetup: { providers: [] } } as unknown as Snapshot;
  const render = (snapshot: Snapshot) => {
    hooks.index = 0;
    hooks.effects = [];
    const tree = AgentSetupWizard({
      api,
      snapshot,
      mode: "primary",
      onClose: close,
    }) as ReactElement<{ onClose(): void }>;
    for (const effect of hooks.effects) effect();
    return tree;
  };
  render(previous).props.onClose();
  expect(abandon).toHaveBeenCalledExactlyOnceWith({ sessionId: "previous" });
  render(empty);
  expect(begin).not.toHaveBeenCalled();
  release();
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  // A new mounted wizard receives one stale snapshot before its removal arrives.
  hooks.refs = [];
  render(previous);
  expect(begin).not.toHaveBeenCalled();
  render(empty);
  expect(begin).toHaveBeenCalledExactlyOnceWith({ mode: "primary" });
  render(empty);
  expect(begin).toHaveBeenCalledOnce();
});
