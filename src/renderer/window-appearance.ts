import { useEffect, useState } from "react";
import type { DesktopApi } from "../bridge/index.js";

/** Native capabilities only; the saved sliders own live window-background appearance. */
export function useWindowAppearance(api: DesktopApi, setError: (message: string) => void) {
  const [customWindowControls, setCustomWindowControls] = useState(false);
  const [sidebarBlurSupported, setSidebarBlurSupported] = useState<boolean>();
  useEffect(() => {
    let mounted = true;
    void api
      .windowAppearance()
      .then((appearance) => {
        if (!mounted) return;
        setCustomWindowControls(appearance.customWindowControls === true);
        setSidebarBlurSupported(appearance.sidebarBlurSupported === true);
      })
      .catch((cause) => {
        if (mounted) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      mounted = false;
    };
  }, [api, setError]);
  return { sidebarBlurSupported, customWindowControls };
}
