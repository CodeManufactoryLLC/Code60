import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../bridge/index.js";
import { hasOrchestrationProvider } from "./snapshot-state.js";
export function useSplashEntry(snapshot: Snapshot | undefined) {
  const directory = snapshot?.directory;
  const orchestratorConfigured = hasOrchestrationProvider(snapshot); // Reloads can skip the splash only after the saved provider has been checked.
  const [splash, setSplash] = useState(true);
  const splashReturned = useRef(sessionStorage.getItem("code60.splashReturned") === "1");
  const enterApp = () => {
    splashReturned.current = false;
    sessionStorage.removeItem("code60.splashReturned");
    sessionStorage.setItem("code60.splashShown", "1");
    setSplash(false);
  };
  const startupChecked = useRef(false);
  const [splashReady, setSplashReady] = useState(false);
  useEffect(() => {
    if (!splash) return;
    let cancelled = false;
    // Wait for the face so the wordmark never flashes in a fallback font.
    void document.fonts
      .load('400 64px "D-DIN"')
      .catch(() => [])
      .then(() => {
        if (!cancelled) setSplashReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [splash]);
  useEffect(() => {
    if (!snapshot || startupChecked.current) return;
    startupChecked.current = true;
    if (
      !splashReturned.current &&
      orchestratorConfigured &&
      sessionStorage.getItem("code60.splashShown")
    )
      setSplash(false);
  }, [snapshot, orchestratorConfigured]);
  useEffect(() => {
    if (!splashReturned.current && splash && directory && orchestratorConfigured) {
      sessionStorage.setItem("code60.splashShown", "1");
      setSplash(false);
    }
  }, [splash, directory, orchestratorConfigured]);
  const returnSplash = () => {
    splashReturned.current = true;
    sessionStorage.setItem("code60.splashReturned", "1");
    sessionStorage.removeItem("code60.splashShown");
    setSplash(true);
  };
  return { splash, splashReady, enterApp, returnSplash };
}
