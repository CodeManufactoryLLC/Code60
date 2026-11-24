import { afterEach, expect, it, vi } from "vitest";
import { installPressFeedback } from "./press-feedback.js";

class Control {
  kind = "button";
  disabled = false;
  blocked = false;
  copy = false;
  iconOnly = false;
  accordion = false;
  carbon = false;
  sidebar = false;
  raised = false;
  isConnected = true;
  icon: Control | null = null;
  input: Control | null = null;
  segmented: Control | null = null;
  actionable: Control | null = this;
  style: Record<string, string> = { display: "inline-flex", scale: "none", opacity: "1" };
  animations: { cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }[] = [];
  animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
    const animation = { cancel: vi.fn(), onfinish: null as (() => void) | null };
    this.animations.push(animation);
    return animation;
  });
  closest(selector: string): Control | null {
    if (selector === ".sidebar") return this.sidebar ? this : null;
    if (selector.includes("[inert]")) return this.blocked ? this : null;
    if (selector === ".message-copy") return this.copy ? this : null;
    if (selector === ".segmented-option") return this.segmented;
    return this.actionable;
  }
  matches(selector: string) {
    if (selector.includes(":disabled")) return this.disabled;
    if (selector.includes(".home-card"))
      return (
        this.raised ||
        (selector.includes(".cds--accordion__heading") && this.accordion) ||
        (selector.includes(".cds--btn") && this.carbon)
      );
    if (selector.includes(".icon-button")) return this.iconOnly;
    return selector === this.kind;
  }
  querySelector(selector: string) {
    return selector === "input" ? this.input : this.icon;
  }
  getBoundingClientRect() {
    return { left: 10, top: 20 };
  }
}

const cleanups: (() => void)[] = [];
function fixture() {
  vi.useFakeTimers();
  const media = Object.assign(new EventTarget(), { matches: false });
  const view = Object.assign(new EventTarget(), {
    matchMedia: () => media,
    performance: { now: () => Date.now() },
    getComputedStyle: (element: Control) => ({
      display: element.style.display,
      getPropertyValue: (property: string) => element.style[property] ?? "",
    }),
  });
  const document = Object.assign(new EventTarget(), { defaultView: view, hidden: false });
  const cleanup = installPressFeedback(document as unknown as Document);
  cleanups.push(cleanup);
  const control = new Control();
  const emit = (type: string, target: Control | null = control, properties = {}) => {
    const event = new Event(type, { cancelable: true });
    const defaults = type.startsWith("pointer")
      ? { pointerId: 1, button: 0, isPrimary: true, clientX: 11, clientY: 21 }
      : {};
    for (const [key, value] of Object.entries({ target, ...defaults, ...properties }))
      Object.defineProperty(event, key, { value });
    document.dispatchEvent(event);
    return event;
  };
  return { control, emit, document, view, media, cleanup };
}
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});

it("presses immediately, holds a quick click visibly and releases without intercepting actions", () => {
  const { control, emit } = fixture();
  expect(emit("pointerdown").defaultPrevented).toBe(false);
  expect(control.animate.mock.calls[0]).toEqual([
    [
      { scale: "1", transformOrigin: "1px 1px" },
      { scale: "0.985", transformOrigin: "1px 1px" },
    ],
    { duration: 60, easing: "ease-out", fill: "forwards" },
  ]);
  emit("pointerup");
  emit("click");
  vi.advanceTimersByTime(49);
  expect(control.animate).toHaveBeenCalledTimes(1);
  control.style.scale = "0.993";
  vi.advanceTimersByTime(1);
  expect(control.animations[0]?.cancel).toHaveBeenCalled();
  expect(control.animate.mock.calls[1]).toEqual([
    [
      { scale: "0.993", transformOrigin: "1px 1px" },
      { scale: "1", transformOrigin: "1px 1px" },
    ],
    { duration: 90, easing: "ease-out", fill: "forwards" },
  ]);
  control.animations[1]?.onfinish?.();
  expect(control.animations[1]?.cancel).toHaveBeenCalled();
});

it("releases long presses immediately on mouse up, including outside the pressed control", () => {
  const { control, emit } = fixture();
  emit("pointerdown");
  vi.advanceTimersByTime(200);
  emit("pointerup", new Control());
  vi.advanceTimersByTime(0);
  expect(control.animate).toHaveBeenCalledTimes(2);
});

it.each(["Enter", " "])("provides keyboard feedback for %j without swallowing keys", (key) => {
  const { control, emit } = fixture();
  expect(emit("keydown", control, { key }).defaultPrevented).toBe(false);
  emit("keydown", control, { key, repeat: true });
  emit("keyup", control, { key: "Escape" });
  vi.advanceTimersByTime(100);
  expect(control.animate).toHaveBeenCalledTimes(1);
  emit("keyup", control, { key });
  vi.advanceTimersByTime(0);
  expect(control.animate).toHaveBeenCalledTimes(2);
});

it("animates only the glyph of an icon action, keeping its control hit target fixed", () => {
  const { control, emit } = fixture();
  control.iconOnly = true;
  control.icon = new Control();
  emit("pointerdown");
  expect(control.animate).not.toHaveBeenCalled();
  expect(control.icon.animate.mock.calls[0]?.[0][1]).toEqual({
    scale: "0.9",
    transformOrigin: "center",
  });
});

it("keeps accordion headers stationary and leaves feedback to disclosure rotation", () => {
  const { control, emit } = fixture();
  control.accordion = true;
  control.icon = new Control();
  emit("pointerdown");
  emit("pointerup");
  vi.advanceTimersByTime(100);
  expect(control.animate).not.toHaveBeenCalled();
  expect(control.icon.animate).not.toHaveBeenCalled();
});

it("leaves Carbon control feedback to the upstream component states", () => {
  const { control, emit } = fixture();
  control.carbon = true;
  emit("pointerdown");
  emit("pointerup");
  vi.advanceTimersByTime(100);
  expect(control.animate).not.toHaveBeenCalled();
});

it("keeps sidebar navigation backgrounds and selection edges fixed during press and release", () => {
  const { control, emit } = fixture();
  control.sidebar = true;
  control.icon = new Control();
  emit("pointerdown");
  expect(control.animate).not.toHaveBeenCalled();
  expect(control.icon.animate.mock.calls[0]?.[0][1]).toEqual({
    scale: "0.9",
    transformOrigin: "center",
  });
  emit("pointerup");
  vi.advanceTimersByTime(50);
  expect(control.icon.animate).toHaveBeenCalledTimes(2);
  expect(control.animate).not.toHaveBeenCalled();
});

it("keeps inline links in text flow and uses a brief opacity depression instead", () => {
  const { control, emit } = fixture();
  control.style.display = "inline";
  control.style.opacity = "0.8";
  emit("pointerdown");
  expect(control.animate.mock.calls[0]?.[0][1]?.opacity).toBeCloseTo(0.576);
});

it("animates the visible segmented label rather than its transparent native radio", () => {
  const { control, emit } = fixture();
  control.kind = "input";
  control.segmented = new Control();
  emit("pointerdown");
  expect(control.animate).not.toHaveBeenCalled();
  expect(control.segmented.animate).toHaveBeenCalledOnce();
});

it.each(["disabled", "blocked", "copy"] as const)("leaves %s controls alone", (state) => {
  const { control, emit } = fixture();
  control[state] = true;
  emit("pointerdown");
  expect(control.animate).not.toHaveBeenCalled();
});

it("uses a nonmoving fallback for CSS-only icon buttons", () => {
  const { control, emit } = fixture();
  control.iconOnly = true;
  emit("pointerdown");
  expect(control.animate.mock.calls[0]?.[0][1]).toMatchObject({ opacity: "0.72" });
});

it("does not animate labels of disabled fields, missing controls or non-actions", () => {
  const { control, emit } = fixture();
  control.kind = "label";
  control.input = new Control();
  control.input.disabled = true;
  emit("pointerdown");
  control.actionable = null;
  emit("pointerdown");
  emit("pointerdown", null);
  expect(control.animate).not.toHaveBeenCalled();
});

it("ignores right clicks, secondary pointers, unrelated keys and another pointer's release", () => {
  const { control, emit } = fixture();
  emit("pointerdown", control, { button: 2 });
  emit("pointerdown", control, { isPrimary: false });
  emit("keydown", control, { key: "a" });
  expect(control.animate).not.toHaveBeenCalled();
  emit("pointerdown");
  emit("pointerup", control, { pointerId: 2 });
  vi.advanceTimersByTime(100);
  expect(control.animate).toHaveBeenCalledOnce();
});

it.each(["pointercancel", "dragstart", "visibilitychange", "blur", "motion"])(
  "cleans up during %s and never leaves a delayed release behind",
  (type) => {
    const { control, emit, document, view, media } = fixture();
    emit("pointerdown");
    emit("pointerup");
    if (type === "blur") view.dispatchEvent(new Event("blur"));
    else if (type === "motion") {
      media.matches = true;
      media.dispatchEvent(new Event("change"));
    } else {
      document.hidden = type === "visibilitychange";
      emit(type);
    }
    vi.advanceTimersByTime(100);
    expect(control.animations[0]?.cancel).toHaveBeenCalled();
    expect(control.animate).toHaveBeenCalledOnce();
  },
);

it("skips motion and cancels on repeated presses, detached targets and disposal", () => {
  const { control, emit, media, cleanup } = fixture();
  media.matches = true;
  emit("pointerdown");
  expect(control.animate).not.toHaveBeenCalled();
  media.matches = false;
  emit("pointerdown");
  emit("pointerup");
  emit("pointerdown");
  expect(control.animations[0]?.cancel).toHaveBeenCalled();
  control.isConnected = false;
  emit("pointerup");
  vi.advanceTimersByTime(60);
  expect(control.animate).toHaveBeenCalledTimes(2);
  cleanup();
  emit("pointerdown");
  expect(control.animate).toHaveBeenCalledTimes(2);
});

it("does not require a live window for detached documents", () => {
  expect(installPressFeedback({ defaultView: null } as Document)).toBeTypeOf("function");
});

it("leaves raised controls to CSS shadow displacement without intercepting clicks or keys", () => {
  const { control, emit } = fixture();
  control.raised = true;
  expect(emit("pointerdown").defaultPrevented).toBe(false);
  emit("pointerup");
  emit("click");
  expect(emit("keydown", control, { key: "Enter" }).defaultPrevented).toBe(false);
  emit("keyup", control, { key: "Enter" });
  vi.runAllTimers();
  expect(control.animate).not.toHaveBeenCalled();
});
