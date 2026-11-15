import type { DependencyList, EffectCallback } from "react";
import { expect, it, vi } from "vitest";
import type { SessionState } from "../core/index.js";
import { SessionInfo } from "./session-info.js";

const hooks = vi.hoisted(() => ({ dependencies: undefined as DependencyList | undefined }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useId: () => "mode-menu",
  useEffect: (_effect: EffectCallback, dependencies: DependencyList) => {
    hooks.dependencies = dependencies;
  },
  useLayoutEffect: () => {},
  useRef: () => ({ current: null }),
  useState: () => [false, vi.fn()],
}));

it("keeps an open mode menu across equivalent pushed snapshots, but not capability changes", () => {
  const state: SessionState = {
    model: null,
    usage: null,
    modes: {
      source: "config",
      confirmed: true,
      reportedAt: "2026-11-14T12:00:00.000Z",
      controls: [
        { id: "mode", name: "Mode", currentValue: "ask", options: [{ value: "ask", name: "Ask" }] },
      ],
    },
  };
  const render = (state: SessionState) =>
    SessionInfo({
      state,
      ended: false,
      editable: true,
      changing: false,
      autoApproval: false,
      harness: "droid",
      sessionId: "same-session",
      onMode: vi.fn(),
    });
  render(state);
  const before = hooks.dependencies;
  const clone = structuredClone(state);
  if (!clone.modes) throw new Error("Missing modes");
  clone.modes.reportedAt = "2026-11-14T12:00:01.000Z";
  render(clone);
  expect(hooks.dependencies?.every((value, index) => Object.is(value, before?.[index]))).toBe(true);
  clone.modes.controls[0]?.options.push({ value: "full", name: "Full Access" });
  render(clone);
  expect(hooks.dependencies?.every((value, index) => Object.is(value, before?.[index]))).toBe(
    false,
  );
});
