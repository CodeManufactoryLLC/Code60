import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { animatePageTransition, usePageTransition } from "./page-transition.js";

const hooks = vi.hoisted(() => ({
  previous: { current: null as string | null },
  effect: undefined as (() => (() => void) | undefined) | undefined,
  dependencies: [] as readonly unknown[],
}));
vi.mock("react", () => ({
  useRef: () => hooks.previous,
  useLayoutEffect: (effect: () => (() => void) | undefined, dependencies: readonly unknown[]) => {
    hooks.effect = effect;
    hooks.dependencies = dependencies;
  },
}));

class Query extends EventTarget {
  matches = false;
}
class Animation extends EventTarget {
  cancel = vi.fn();
}
const reduce = new Query();
const forced = new Query();
const animation = new Animation();
const panel = { closest: vi.fn(), animate: vi.fn(() => animation) };
const documentTarget = Object.assign(new EventTarget(), {
  visibilityState: "visible",
  getElementById: vi.fn(() => panel),
});
let duration = "175ms";
let cleanup: (() => void) | undefined;
let dependencies: readonly unknown[] = [];
function render(page: string, identity?: string, enabled = true) {
  // biome-ignore lint/correctness/useHookAtTopLevel: supporting lifecycle harness with mocked React.
  usePageTransition(page, identity, enabled);
  if (
    dependencies.length === hooks.dependencies.length &&
    dependencies.every((value, index) => Object.is(value, hooks.dependencies[index]))
  )
    return;
  cleanup?.();
  dependencies = hooks.dependencies;
  cleanup = hooks.effect?.();
}
beforeEach(() => {
  hooks.previous.current = null;
  dependencies = [];
  duration = "175ms";
  reduce.matches = false;
  forced.matches = false;
  documentTarget.visibilityState = "visible";
  vi.clearAllMocks();
  panel.closest.mockReturnValue(null);
  vi.stubGlobal("document", documentTarget);
  vi.stubGlobal("window", {
    matchMedia: (query: string) => (query.includes("reduced-motion") ? reduce : forced),
  });
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (key: string) => (key === "--motion" ? duration : "ease-out"),
  }));
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
});

it("fades the actual destination without remounting it or replaying on background updates", () => {
  render("home");
  expect(panel.animate).not.toHaveBeenCalled();
  render("search");
  expect(documentTarget.getElementById).toHaveBeenLastCalledWith("panel-search");
  expect(panel.animate).toHaveBeenCalledExactlyOnceWith([{ opacity: 0.4 }, { opacity: 1 }], {
    duration: 175,
    easing: "ease-out",
  });
  render("search");
  expect(panel.animate).toHaveBeenCalledOnce();
  render("settings", "appearance");
  expect(animation.cancel).toHaveBeenCalledOnce();
  render("settings", "about");
  render("project", "project-a");
  render("project", "project-b");
  render("chat", "conversation-a");
  render("chat", "worker-b");
  expect(panel.animate).toHaveBeenCalledTimes(7);
});

it.each(["reduced", "forced", "hidden", "inert", "splash"] as const)(
  "does not animate %s destinations",
  (state) => {
    render("home");
    if (state === "reduced") reduce.matches = true;
    if (state === "forced") forced.matches = true;
    if (state === "hidden") documentTarget.visibilityState = "hidden";
    if (state === "inert") panel.closest.mockReturnValue({} as HTMLElement);
    render("search", undefined, state !== "splash");
    expect(panel.animate).not.toHaveBeenCalled();
  },
);

it.each(["reduced", "forced", "hidden", "finish"] as const)(
  "settles promptly on %s and cleans up exactly once",
  (state) => {
    cleanup = animatePageTransition(panel as unknown as HTMLElement);
    if (state === "reduced") {
      reduce.matches = true;
      reduce.dispatchEvent(new Event("change"));
    } else if (state === "forced") {
      forced.matches = true;
      forced.dispatchEvent(new Event("change"));
    } else if (state === "hidden") {
      documentTarget.visibilityState = "hidden";
      documentTarget.dispatchEvent(new Event("visibilitychange"));
    } else animation.dispatchEvent(new Event("finish"));
    expect(animation.cancel).toHaveBeenCalledOnce();
    cleanup?.();
    expect(animation.cancel).toHaveBeenCalledOnce();
  },
);

it("reads shared motion units and respects disabled or invalid durations", () => {
  duration = "0.175s";
  cleanup = animatePageTransition(panel as unknown as HTMLElement);
  expect(panel.animate).toHaveBeenLastCalledWith(expect.anything(), {
    duration: 175,
    easing: "ease-out",
  });
  cleanup?.();
  for (duration of ["0ms", "-1ms", "invalid"]) {
    expect(animatePageTransition(panel as unknown as HTMLElement)).toBeUndefined();
  }
  expect(panel.animate).toHaveBeenCalledOnce();
});
