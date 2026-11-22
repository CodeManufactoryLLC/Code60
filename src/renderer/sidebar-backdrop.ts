import { useEffect, useState } from "react";
import {
  type DesktopApi,
  inactiveSidebarBackdrop,
  sidebarBackdropWidthLimit,
} from "../bridge/index.js";
import type { SidebarAppearance } from "./appearance.js";

const blurError =
  "Native window background blur could not be applied. Try changing the blur strength again.";

/** Own subscriptions, batched visible geometry, and immediate hidden-state reporting. */
export function observeSidebarBackdrop(
  api: Pick<DesktopApi, "setSidebarBackdrop" | "onSidebarBackdropError">,
  appearance: SidebarAppearance,
  splash: boolean,
  setError: (message: string) => void,
) {
  const element = document.querySelector<HTMLElement>(".window-background");
  const forced = window.matchMedia("(forced-colors: active)");
  let frame = 0;
  let disposed = false;
  let revision = 0;
  const report = () => {
    frame = 0;
    const current = ++revision;
    const width = element?.getBoundingClientRect().width ?? 0;
    const active = !splash && !document.hidden && !forced.matches && appearance.opacity < 100;
    void api
      .setSidebarBackdrop({
        width: Math.min(sidebarBackdropWidthLimit, Math.max(0, width)),
        strength: active ? appearance.blur : 0,
        visible: active && width > 0,
      })
      .then(() => {
        if (!disposed && current === revision) setError("");
      })
      .catch(() => {
        if (!disposed && current === revision) setError(blurError);
      });
  };
  const update = () => {
    // Hidden documents may never receive another animation frame.
    if (document.hidden || forced.matches) {
      cancelAnimationFrame(frame);
      report();
    } else if (!frame) frame = requestAnimationFrame(report);
  };
  const resize = new ResizeObserver(update);
  if (element) resize.observe(element);
  const offError = api.onSidebarBackdropError(() => {
    ++revision;
    if (!disposed) setError(blurError);
  });
  forced.addEventListener("change", update);
  document.addEventListener("visibilitychange", update);
  report();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resize.disconnect();
    offError();
    forced.removeEventListener("change", update);
    document.removeEventListener("visibilitychange", update);
    void api.setSidebarBackdrop(inactiveSidebarBackdrop).catch(() => {});
  };
}

export function useSidebarBackdrop(
  api: DesktopApi,
  appearance: SidebarAppearance,
  supported: boolean | undefined,
  splash: boolean,
) {
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supported) return;
    return observeSidebarBackdrop(api, appearance, splash, setError);
  }, [api, appearance, supported, splash]);
  return error;
}
