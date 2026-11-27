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
class Content {
  closest = vi.fn();
  matches = vi.fn(() => false);
  getClientRects = vi.fn(() => [{}]);
  animate = vi.fn(() => animation);
  setAttribute = vi.fn();
  removeAttribute = vi.fn();
}
const content = new Content();
const panel = {
  id: "panel-home",
  closest: vi.fn(),
  animate: vi.fn(),
  querySelectorAll: vi.fn(() => [] as Content[]),
  children: [content],
};
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
  content.closest.mockReturnValue(null);
  content.matches.mockReturnValue(false);
  content.getClientRects.mockReturnValue([{}]);
  panel.querySelectorAll.mockReturnValue([]);
  panel.children = [content];
  panel.id = "panel-home";
  vi.stubGlobal("HTMLElement", Content);
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

it("moves destination content without dimming its shell or replaying background updates", () => {
  render("home");
  expect(content.animate).not.toHaveBeenCalled();
  render("search");
  expect(documentTarget.getElementById).toHaveBeenLastCalledWith("panel-search");
  expect(content.animate).toHaveBeenCalledExactlyOnceWith(
    [{ translate: "0px 6px" }, { translate: "0px 0px" }],
    {
      duration: 175,
      easing: "ease-out",
    },
  );
  render("search");
  expect(content.animate).toHaveBeenCalledOnce();
  render("settings", "appearance");
  expect(animation.cancel).toHaveBeenCalledOnce();
  render("settings", "about");
  render("chat", "conversation-a");
  render("chat", "worker-b");
  expect(content.animate).toHaveBeenCalledTimes(5);
});

it("does not replay an entrance when a visible page receives its initial identity", () => {
  render("home");
  render("chat");
  expect(content.animate).toHaveBeenCalledOnce();
  render("chat", "restored-chat");
  expect(content.animate).toHaveBeenCalledOnce();
  render("chat", "different-chat");
  expect(content.animate).toHaveBeenCalledTimes(2);
});

it("still animates explicit Settings home-to-section navigation", () => {
  render("settings");
  render("settings", "appearance");
  expect(content.animate).toHaveBeenCalledOnce();
});

it("selects the active settings/chat content and never animates hidden views or the card", () => {
  const hidden = new Content();
  hidden.closest.mockReturnValue({});
  panel.querySelectorAll.mockReturnValue([hidden, content]);
  panel.id = "panel-chat";
  cleanup = animatePageTransition(panel as unknown as HTMLElement);
  expect(content.animate).toHaveBeenCalledOnce();
  expect(panel.animate).not.toHaveBeenCalled();
  expect(hidden.animate).not.toHaveBeenCalled();
  cleanup?.();
  expect(content.removeAttribute).toHaveBeenCalledWith("data-page-entering");
  panel.querySelectorAll.mockReturnValue([hidden]);
  expect(animatePageTransition(panel as unknown as HTMLElement)).toBeUndefined();
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
    expect(content.animate).not.toHaveBeenCalled();
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
  expect(content.animate).toHaveBeenLastCalledWith(expect.anything(), {
    duration: 175,
    easing: "ease-out",
  });
  cleanup?.();
  for (duration of ["0ms", "-1ms", "invalid"]) {
    expect(animatePageTransition(panel as unknown as HTMLElement)).toBeUndefined();
  }
  expect(content.animate).toHaveBeenCalledOnce();
});
