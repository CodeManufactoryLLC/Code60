import { useEffect, useState } from "react";
import type { DesktopApi } from "../bridge/index.js";

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
export function useWindowAppearance(api: DesktopApi, setError: (message: string) => void) {
  const [transparent, setTransparent] = useState<boolean>();
  const [savingAppearance, setSavingAppearance] = useState(false);
  useEffect(() => {
    let mounted = true;
    let cleanup = () => {};
    void api
      .windowAppearance()
      .then((appearance) => {
        if (!mounted) return;
        setTransparent(appearance.enabled);
        document.documentElement.dataset.transparent = String(appearance.transparent);
        if (!appearance.clickThrough) return;
        let ignored = false;
        const hitTest = (event: MouseEvent) => {
          // Native traffic lights must remain clickable.
          const nativeControls = event.clientY < 28 && event.clientX < 80;
          const element = document.elementFromPoint(event.clientX, event.clientY);
          const content = element?.closest(
            ".app-footer, .sidebar, .chat-sidebar, .file-inspector, .page-panel, .page-tab, .database-notice, .splash, dialog[open], .actions-menu, .app-toast, .command-palette",
          );
          const next = !nativeControls && !content && !document.querySelector("dialog[open]");
          if (ignored === next) return;
          ignored = next;
          void api.setBackgroundHitTest(next).catch((cause) => setError(message(cause)));
        };
        // Electron forwards mousemove (not pointermove) while the window ignores mouse events.
        window.addEventListener("mousemove", hitTest);
        cleanup = () => {
          window.removeEventListener("mousemove", hitTest);
          void api.setBackgroundHitTest(false).catch(() => {});
        };
      })
      .catch((cause) => {
        if (mounted) setError(message(cause));
      });
    return () => {
      mounted = false;
      cleanup();
    };
  }, [api, setError]);
  const saveTransparent = async (enabled: boolean) => {
    const previous = transparent;
    setTransparent(enabled);
    setSavingAppearance(true);
    try {
      await api.setTransparent(enabled);
    } catch (cause) {
      setTransparent(previous);
      setError(message(cause));
    } finally {
      setSavingAppearance(false);
    }
  };
  return { transparent, savingAppearance, saveTransparent };
}
