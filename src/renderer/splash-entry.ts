import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../bridge/index.js";
import { hasOrchestrationProvider } from "./snapshot-state.js";

export function useSplashEntry(snapshot: Snapshot | undefined) {
  const [splash, setSplash] = useState(true);
  const explicit = useRef(sessionStorage.getItem("code60.splashReturned") === "1");
  const [setupOpen, setSetupOpen] = useState(false);
  const configured = hasOrchestrationProvider(snapshot);
  useEffect(() => {
    if (configured && !explicit.current && !setupOpen) setSplash(false);
  }, [configured, setupOpen]);
  return {
    splash,
    splashReady: true,
    setSetupOpen,
    enterApp() {
      explicit.current = false;
      sessionStorage.removeItem("code60.splashReturned");
      setSplash(false);
    },
    returnSplash() {
      explicit.current = true;
      sessionStorage.setItem("code60.splashReturned", "1");
      setSplash(true);
    },
  };
}
