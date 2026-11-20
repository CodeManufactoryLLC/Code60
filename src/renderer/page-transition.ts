import { useLayoutEffect, useRef } from "react";

/** Move destination content over its opaque shell; never fade the card/background. */
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
  const specific = panel.querySelectorAll<HTMLElement>(
    '.chat-conversations > .orchestration-chat-page .transcript, :scope > .settings-page > [role="tabpanel"]',
  );
  const candidates = panel.id === "panel-chat" ? [...specific] : [...specific, ...panel.children];
  const content = candidates.find(
    (node): node is HTMLElement =>
      node instanceof HTMLElement &&
      !node.closest("[hidden], [inert]") &&
      !node.matches(".error-banner, .warning-banner") &&
      node.getClientRects().length > 0,
  );
  if (!content) return;
  const animation = content.animate([{ translate: "0px 6px" }, { translate: "0px 0px" }], {
    duration,
    easing: style.getPropertyValue("--ease").trim() || "ease-out",
  });
  content.setAttribute("data-page-entering", "true");
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    animation.cancel();
    content.removeAttribute("data-page-entering");
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
    // Hydration can fill a chat/project identity after its page is already visible.
    // That detail arrival must not restart a second entrance.
    const [priorPage, priorIdentity] = JSON.parse(prior) as [string, string | null];
    if (
      (page === "chat" || page === "project") &&
      priorPage === page &&
      priorIdentity === null &&
      identity != null
    )
      return;
    const panel = document.getElementById(`panel-${page}`);
    if (panel) return animatePageTransition(panel);
  }, [page, key, enabled, identity]);
}
