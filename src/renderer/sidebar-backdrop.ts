import { useEffect } from "react";
import type { DesktopApi } from "../bridge/index.js";
import type { SidebarAppearance } from "./appearance.js";

export function useSidebarBackdrop(
  api: DesktopApi,
  appearance: SidebarAppearance,
  supported: boolean | undefined,
  splash: boolean,
  setError: (message: string) => void,
) {
  useEffect(() => {
    if (!supported) return;
    const element = document.querySelector(".sidebar-background");
    const forced = window.matchMedia("(forced-colors: active)");
    let disposed = false;
    let frame = 0;
    const report = () => {
      frame = 0;
      const width = element?.getBoundingClientRect().width ?? 0;
      void api
        .setSidebarBackdrop({
          width: Math.max(0, Math.min(16384, width)),
          strength: appearance.blur,
          visible:
            !splash && !document.hidden && !forced.matches && appearance.opacity < 100 && width > 0,
        })
        .catch(() => {
          if (!disposed)
            setError(
              "Native sidebar blur could not be applied. Try changing the blur strength again.",
            );
        });
    };
    const update = () => {
      if (!frame) frame = requestAnimationFrame(report);
    };
    const resize = new ResizeObserver(update);
    if (element) resize.observe(element);
    forced.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    report();
    return () => {
      disposed = true;
      resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
      forced.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [api, appearance.blur, appearance.opacity, supported, splash, setError]);
  useEffect(
    () => () => {
      if (supported)
        void api.setSidebarBackdrop({ width: 0, strength: 0, visible: false }).catch(() => {});
    },
    [api, supported],
  );
}
