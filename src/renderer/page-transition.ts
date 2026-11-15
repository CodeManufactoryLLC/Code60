import { useLayoutEffect, useRef } from "react";

/** Animate only the newly selected panel; never mount, delay or replay navigation. */
export function animatePageTransition(panel: HTMLElement): (() => void) | undefined {
  const media = [
    window.matchMedia("(prefers-reduced-motion: reduce)"),
    window.matchMedia("(forced-colors: active)"),
  ];
  const unavailable = () =>
    document.visibilityState !== "visible" || media.some((query) => query.matches);
  if (unavailable() || panel.closest("[hidden], [inert]") || !panel.animate) return;
  const style = getComputedStyle(panel);
  const time = style.getPropertyValue("--motion").trim();
  const duration = Number.parseFloat(time) * (time.endsWith("ms") ? 1 : 1000);
  if (!Number.isFinite(duration) || duration <= 0) return;
  const animation = panel.animate([{ opacity: 0.4 }, { opacity: 1 }], {
    duration,
    easing: style.getPropertyValue("--ease").trim() || "ease-out",
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    animation.cancel();
    for (const query of media) query.removeEventListener("change", settle);
    document.removeEventListener("visibilitychange", settle);
    animation.removeEventListener("finish", dispose);
  };
  const settle = () => {
    if (unavailable()) dispose();
  };
  for (const query of media) query.addEventListener("change", settle);
  document.addEventListener("visibilitychange", settle);
  animation.addEventListener("finish", dispose, { once: true });
  return dispose;
}

export function usePageTransition(
  page: string,
  identity: string | null | undefined,
  enabled: boolean,
) {
  const previous = useRef<string | null>(null);
  const key = JSON.stringify([page, identity]);
  useLayoutEffect(() => {
    const prior = previous.current;
    previous.current = key;
    if (prior === null || prior === key || !enabled) return;
    const panel = document.getElementById(`panel-${page}`);
    if (panel) return animatePageTransition(panel);
  }, [page, key, enabled]);
}
