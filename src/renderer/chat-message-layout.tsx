import { type ReactNode, useLayoutEffect, useRef } from "react";
import { useTransitionTimes } from "./transition-times.js";

/** Animate occupied space, not a translated status row that would overlap the reply. */
export function createMessageLayout(
  element: HTMLElement,
  content: HTMLElement,
  incoming: boolean,
  animate: () => boolean,
) {
  let width: number | undefined;
  const height = (target: number, smooth: boolean) => {
    const moving = smooth && animate();
    element.dataset.layoutImmediate = String(!moving);
    if (!moving) delete element.dataset.layoutAnimating;
    if (moving && Math.abs(Number.parseFloat(element.style.height) - target) < 0.1) return;
    if (moving) element.dataset.layoutAnimating = "true";
    element.style.height = `${target}px`;
  };
  if (incoming && animate()) {
    const bounds = content.getBoundingClientRect();
    width = bounds.width;
    height(0, false);
    // Establish the zero-height starting layout before revealing a newly inserted message.
    element.getBoundingClientRect();
    height(bounds.height, true);
  } else element.dataset.layoutImmediate = "true";
  const resize = new ResizeObserver((entries) => {
    // Use the browser's batched measurement, avoiding read/write layout flushes per
    // historical message when a long conversation is mounted.
    const bounds = entries[0]?.contentRect;
    if (!bounds) return;
    const reflow = width === undefined || Math.abs(width - bounds.width) > 0.1;
    width = bounds.width;
    height(bounds.height, !reflow);
  });
  resize.observe(content);
  const ended = (event: TransitionEvent) => {
    if (event.target === element && event.propertyName === "height")
      delete element.dataset.layoutAnimating;
  };
  element.addEventListener("transitionend", ended);
  return {
    settle() {
      const bounds = content.getBoundingClientRect();
      width = bounds.width;
      height(bounds.height, false);
    },
    dispose() {
      resize.disconnect();
      element.removeEventListener("transitionend", ended);
      delete element.dataset.layoutAnimating;
      element.dataset.layoutImmediate = "true";
      element.style.height = "auto";
    },
  };
}

export function ChatMessageLayout({
  children,
  incoming,
  active,
}: {
  children: ReactNode;
  incoming: boolean;
  active: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const fresh = useRef(incoming);
  const { replyEntrance } = useTransitionTimes();
  useLayoutEffect(() => {
    const outer = element.current;
    const inner = content.current;
    if (!active || !outer || !inner) {
      fresh.current = false;
      return;
    }
    const media = window.matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active)");
    const layout = createMessageLayout(
      outer,
      inner,
      fresh.current,
      () => replyEntrance > 0 && !media.matches && document.visibilityState === "visible",
    );
    fresh.current = false;
    media.addEventListener("change", layout.settle);
    document.addEventListener("visibilitychange", layout.settle);
    return () => {
      layout.dispose();
      media.removeEventListener("change", layout.settle);
      document.removeEventListener("visibilitychange", layout.settle);
    };
  }, [active, replyEntrance]);
  return (
    <div className="chat-message-layout" ref={element}>
      <div className="chat-message-layout-content" ref={content}>
        {children}
      </div>
    </div>
  );
}
