import { useEffect } from "react";

const clickables = [
  "button",
  "a[href]",
  "summary",
  "select",
  'input:is([type="button"], [type="submit"], [type="reset"], [type="checkbox"], [type="radio"])',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="treeitem"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  'label:has(input:is([type="checkbox"], [type="radio"]))',
].join(",");

/** One delegated visual effect, without delaying, cancelling or replaying any action. */
export function installPressFeedback(document: Document): () => void {
  const view = document.defaultView;
  if (!view) return () => {};
  const reduced = view.matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active)");
  const animations = new Map<Element, Animation>();
  const capture = { capture: true };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let held:
    | {
        target: Element;
        property: "scale" | "opacity";
        rest: string;
        origin: string;
        started: number;
        pointerId?: number;
        key?: string;
      }
    | undefined;

  const animate = (
    target: Element,
    property: string,
    value: string,
    origin: string,
    release: boolean,
  ) => {
    const from = view.getComputedStyle(target).getPropertyValue(property) || "1";
    animations.get(target)?.cancel();
    const animation = target.animate(
      [
        { [property]: from === "none" ? "1" : from, transformOrigin: origin },
        { [property]: value, transformOrigin: origin },
      ],
      { duration: release ? 90 : 60, easing: "ease-out", fill: "forwards" },
    );
    animations.set(target, animation);
    if (release)
      animation.onfinish = () => {
        animation.cancel();
        if (animations.get(target) === animation) animations.delete(target);
      };
  };
  const reset = () => {
    clearTimeout(timer);
    held = undefined;
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
  };
  const release = () => {
    if (!held) return;
    clearTimeout(timer);
    const press = held;
    timer = setTimeout(
      () => {
        held = undefined;
        if (!press.target.isConnected) {
          animations.get(press.target)?.cancel();
          animations.delete(press.target);
          return;
        }
        animate(press.target, press.property, press.rest, press.origin, true);
      },
      Math.max(0, 50 - (view.performance.now() - press.started)),
    );
  };
  const down = (event: PointerEvent | KeyboardEvent) => {
    if (reduced.matches) return;
    if (
      "pointerId" in event
        ? event.button !== 0 || !event.isPrimary
        : event.repeat || (event.key !== "Enter" && event.key !== " ")
    )
      return;
    const source = event.target as Element | null;
    let control = source?.closest?.(clickables);
    // The invisible native radio covers the whole segmented label.
    if (control?.matches("input")) control = control.closest(".segmented-option") ?? control;
    if (
      !control ||
      control.closest('[inert], [aria-disabled="true"]') ||
      control.matches(':disabled, [role="separator"]') ||
      (control.matches("label") && control.querySelector("input")?.matches(":disabled")) ||
      control.closest(".message-copy")
    )
      return;
    reset();
    // Raised controls use hard-shadow displacement in CSS, never a second scale effect.
    if (
      control.matches(
        ".home-card, .neo-button, .neo-accordion-trigger, .primary, .destructive, .splash-enter, .sidebar-card-toggle, .project-sidebar-open, .project-folder-stop, .project-session-add, .project-chat-toggle",
      )
    )
      return;
    const iconOnly = control.matches(".icon-button, .gdg-search-bar-inner button");
    const contentOnly = iconOnly || control.closest(".sidebar") !== null;
    const target = contentOnly
      ? (control.querySelector("svg, img, .navigation-icon") ?? control)
      : control;
    if (!target?.animate) return;
    const style = view.getComputedStyle(target);
    const property =
      (contentOnly && target === control) || (style.display === "inline" && !contentOnly)
        ? "opacity"
        : "scale";
    const raw = style.getPropertyValue(property);
    const rest = !raw || raw === "none" ? "1" : raw;
    const bounds = target.getBoundingClientRect();
    // Scale around the pointer so an edge click does not move out from under it.
    const origin =
      !contentOnly && "clientX" in event
        ? `${event.clientX - bounds.left}px ${event.clientY - bounds.top}px`
        : "center";
    held = {
      target,
      property,
      rest,
      origin,
      started: view.performance.now(),
      ...("pointerId" in event ? { pointerId: event.pointerId } : { key: event.key }),
    };
    animate(
      target,
      property,
      property === "opacity" ? String(Number(rest) * 0.72) : contentOnly ? "0.9" : "0.985",
      origin,
      false,
    );
  };
  const keyDown = (event: KeyboardEvent) => down(event);
  const pointerDown = (event: PointerEvent) => down(event);
  const pointerUp = (event: PointerEvent) => {
    if (held?.pointerId === event.pointerId) release();
  };
  const keyUp = (event: KeyboardEvent) => {
    if (held?.key === event.key) release();
  };
  const visibility = () => {
    if (document.hidden) reset();
  };
  document.addEventListener("pointerdown", pointerDown, capture);
  document.addEventListener("pointerup", pointerUp, capture);
  document.addEventListener("pointercancel", reset, capture);
  document.addEventListener("click", release, capture);
  document.addEventListener("keydown", keyDown, capture);
  document.addEventListener("keyup", keyUp, capture);
  document.addEventListener("dragstart", reset, capture);
  document.addEventListener("visibilitychange", visibility);
  view.addEventListener("blur", reset);
  reduced.addEventListener("change", reset);
  return () => {
    reset();
    document.removeEventListener("pointerdown", pointerDown, capture);
    document.removeEventListener("pointerup", pointerUp, capture);
    document.removeEventListener("pointercancel", reset, capture);
    document.removeEventListener("click", release, capture);
    document.removeEventListener("keydown", keyDown, capture);
    document.removeEventListener("keyup", keyUp, capture);
    document.removeEventListener("dragstart", reset, capture);
    document.removeEventListener("visibilitychange", visibility);
    view.removeEventListener("blur", reset);
    reduced.removeEventListener("change", reset);
  };
}

export function usePressFeedback() {
  useEffect(() => installPressFeedback(document), []);
}
