import type { BrowserWindow } from "electron";
import type { WindowControl } from "../bridge/index.js";

/** Operates only on the owned main window; close preserves normal shutdown guards. */
export function controlWindow(
  window: Pick<BrowserWindow, "isMaximized" | "maximize" | "unmaximize" | "minimize" | "close">,
  action: WindowControl,
) {
  if (action === "minimize") window.minimize();
  else if (action === "maximize") {
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  } else window.close();
}
