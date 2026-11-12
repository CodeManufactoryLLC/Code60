import { useEffect, useRef } from "react";
import { defaultTransitionTimes, useTransitionTimes } from "./transition-times.js";

interface ReadingPosition {
  following: boolean;
  top: number;
}

/** One retargetable animation, rather than a new native smooth scroll for every chunk. */
export function createChatScroll(
  element: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight" | "clientWidth">,
  position: ReadingPosition,
  animate: () => boolean,
  response: () => number = () => defaultTransitionTimes.scrollResponse,
  layoutMoving: () => boolean = () => false,
) {
  let frame: number | undefined;
  let revealFrame: number | undefined;
  let previous = 0;
  let remainder = 0;
  let written = element.scrollTop;
  const geometry = () => `${element.clientWidth}:${element.clientHeight}:${element.scrollHeight}`;
  let measured = geometry();
  const bottom = () => Math.max(0, element.scrollHeight - element.clientHeight);
  const write = (top: number) => {
    element.scrollTop = top;
    written = element.scrollTop;
    position.top = written;
  };
  const cancelFollow = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    remainder = 0;
  };
  const cancel = () => {
    cancelFollow();
    if (revealFrame !== undefined) cancelAnimationFrame(revealFrame);
    revealFrame = undefined;
  };
  const tick = (now: number) => {
    frame = undefined;
    if (!position.following) return;
    const distance = bottom() - element.scrollTop;
    const duration = response();
    if (!animate() || duration <= 0 || layoutMoving() || Math.abs(distance) <= 1) {
      write(bottom());
      return;
    }
    const elapsed = Math.min(64, Math.max(0, now - previous));
    previous = now;
    // Carry rounding error so very slow settings still move gradually on pixel-rounded viewports.
    const next = element.scrollTop + distance * (1 - Math.exp(-elapsed / duration)) + remainder;
    write(next);
    remainder = Math.abs(next - element.scrollTop) < 1 ? next - element.scrollTop : 0;
    frame = requestAnimationFrame(tick);
  };
  const update = (immediate = false) => {
    measured = geometry();
    if (!position.following) {
      cancelFollow();
      if (immediate) {
        cancel();
        write(position.top);
      }
    } else if (immediate || !animate() || response() <= 0 || layoutMoving()) {
      cancel();
      write(bottom());
    } else if (frame === undefined && Math.abs(bottom() - element.scrollTop) > 1) {
      previous = performance.now();
      remainder = 0;
      frame = requestAnimationFrame(tick);
    }
  };
  return {
    update,
    pause() {
      cancel();
      position.following = false;
      position.top = element.scrollTop;
    },
    resume() {
      cancel();
      position.following = true;
      update();
    },
    reveal(top: number, duration = 0, valid: () => boolean = () => true) {
      cancel();
      position.following = false;
      write(top);
      if (duration <= 0 || !animate()) return;
      const started = performance.now();
      const reveal = (now: number) => {
        revealFrame = undefined;
        if (!valid()) return;
        write(top);
        if (animate() && now - started < duration) revealFrame = requestAnimationFrame(reveal);
      };
      revealFrame = requestAnimationFrame(reveal);
    },
    onScroll() {
      // Layout changes and our own frames are not user requests to stop following.
      if (position.following && measured !== geometry()) {
        update();
        return;
      }
      const top = element.scrollTop;
      if (Math.abs(top - written) < 1) return;
      if (revealFrame !== undefined) cancel();
      const down = top > position.top;
      position.following = bottom() - top < 1 || (down && bottom() - top < 80);
      position.top = top;
      written = top;
      if (position.following) update();
      else cancel();
    },
    dispose: cancel,
  };
}

export function useChatScroll(active: boolean, key: string) {
  const { scrollResponse } = useTransitionTimes();
  const response = useRef(scrollResponse);
  response.current = scrollResponse;
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const saved = useRef({ key, following: true, top: 0 });
  const controller = useRef<ReturnType<typeof createChatScroll> | null>(null);
  useEffect(() => {
    if (saved.current.key !== key) saved.current = { key, following: true, top: 0 };
    const element = scroll.current;
    if (!active || !element) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const current = createChatScroll(
      element,
      saved.current,
      () => !media.matches && document.visibilityState === "visible",
      () => response.current,
      // Height already eases each frame. Applying a second easing would throw the status
      // below the viewport before scrolling caught up with it.
      () => content.current?.querySelector("[data-layout-animating='true']") != null,
    );
    controller.current = current;
    // Initial history and returning to a conversation restore without replaying motion.
    current.update(true);
    const resize = new ResizeObserver(() => current.update());
    resize.observe(element);
    if (content.current) resize.observe(content.current);
    const settle = () => current.update(true);
    const wheel = (event: WheelEvent) => {
      if (event.deltaY < 0) current.pause();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (
        ["ArrowUp", "PageUp", "Home"].includes(event.key) ||
        (event.shiftKey && event.key === " ")
      )
        current.pause();
    };
    const pointer = (event: PointerEvent) => {
      if (event.target === element) current.pause();
    };
    element.addEventListener("scroll", current.onScroll);
    element.addEventListener("wheel", wheel, { passive: true });
    element.addEventListener("keydown", keyboard);
    element.addEventListener("pointerdown", pointer);
    element.addEventListener("touchstart", current.pause, { passive: true });
    media.addEventListener("change", settle);
    document.addEventListener("visibilitychange", settle);
    return () => {
      current.dispose();
      controller.current = null;
      resize.disconnect();
      element.removeEventListener("scroll", current.onScroll);
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("keydown", keyboard);
      element.removeEventListener("pointerdown", pointer);
      element.removeEventListener("touchstart", current.pause);
      media.removeEventListener("change", settle);
      document.removeEventListener("visibilitychange", settle);
    };
  }, [active, key]);
  useEffect(() => {
    controller.current?.update(scrollResponse === 0);
  }, [scrollResponse]);
  return {
    scroll,
    content,
    pause: () => controller.current?.pause(),
    reveal: (top: number, duration: number, valid: () => boolean) =>
      controller.current?.reveal(top, duration, valid),
    resume: () => {
      saved.current.following = true;
      controller.current?.resume();
    },
  };
}
