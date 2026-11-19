import type { EventEmitter } from "node:events";
import { BaseWindow, type BrowserWindow } from "electron";
import { inactiveSidebarBackdrop, type SidebarBackdropRequest } from "../bridge/index.js";

/** A native, mouse-transparent backdrop behind the owned foreground window only. */
export class SidebarBackdrop {
  private backdrop: BaseWindow | undefined;
  private request: SidebarBackdropRequest = inactiveSidebarBackdrop;
  private ownerHidden = false;
  private backdropShown = false;
  private disposed = false;
  private syncing = false;
  private readonly events = [
    "move",
    "resize",
    "minimize",
    "restore",
    "focus",
    "enter-full-screen",
    "leave-full-screen",
  ] as const;

  constructor(
    private readonly owner: BrowserWindow,
    private readonly onFailure: () => void,
  ) {
    for (const event of this.events) (owner as EventEmitter).on(event, this.syncEvent);
    owner.on("show", this.show);
    owner.on("hide", this.hide);
    owner.on("closed", this.dispose);
    owner.webContents.on("did-start-navigation", this.reset);
    owner.webContents.on("render-process-gone", this.reset);
  }

  update(request: SidebarBackdropRequest) {
    if (this.disposed) return;
    this.request = request;
    if (this.sync() === false) throw new Error("Native sidebar blur is unavailable.");
  }

  private readonly reset = () => {
    this.request = inactiveSidebarBackdrop;
    this.syncEvent();
  };

  private readonly show = () => {
    this.ownerHidden = false;
    this.syncEvent();
  };

  private readonly hide = () => {
    this.ownerHidden = true;
    this.syncEvent();
  };

  private readonly syncEvent = () => {
    if (this.sync() === false) this.onFailure();
  };

  private readonly sync = () => {
    if (this.disposed || this.syncing || this.owner.isDestroyed()) return;
    const { width, strength, visible } = this.request;
    try {
      this.syncing = true;
      // Electron 45's macOS isVisible() reverses the occlusion predicate. Owner
      // events plus the renderer visibility report own this decorative window.
      if (!visible || !strength || !width || this.ownerHidden || this.owner.isMinimized()) {
        this.backdrop?.hide();
        this.backdropShown = false;
        return;
      }
      const bounds = this.owner.getContentBounds();
      const zoom = this.owner.webContents.getZoomFactor();
      const pixels = Math.max(0, Math.min(bounds.width, Math.round(width * zoom)));
      if (!pixels) {
        this.backdrop?.hide();
        this.backdropShown = false;
        return;
      }
      if (!this.backdrop || this.backdrop.isDestroyed()) {
        this.backdrop = new BaseWindow({
          show: false,
          frame: false,
          transparent: true,
          backgroundColor: "#00000000",
          hasShadow: false,
          focusable: false,
          skipTaskbar: true,
          hiddenInMissionControl: true,
          resizable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          vibrancy: "sidebar",
          visualEffectState: "active",
        });
        this.backdrop.contentView.setBackgroundColor("#00000000");
        this.backdrop.setIgnoreMouseEvents(true);
      }
      this.backdrop.setBounds({ ...bounds, width: pixels });
      this.backdrop.setOpacity(strength / 100);
      if (!this.backdropShown) {
        this.backdrop.showInactive();
        this.backdropShown = true;
      }
      this.owner.moveAbove(this.backdrop.getMediaSourceId());
    } catch {
      this.closeBackdrop();
      return false;
    } finally {
      this.syncing = false;
    }
  };

  private closeBackdrop() {
    const backdrop = this.backdrop;
    this.backdrop = undefined;
    this.backdropShown = false;
    if (backdrop && !backdrop.isDestroyed()) backdrop.close();
  }

  readonly dispose = () => {
    if (this.disposed) return;
    this.disposed = true;
    for (const event of this.events)
      (this.owner as EventEmitter).removeListener(event, this.syncEvent);
    this.owner.removeListener("show", this.show);
    this.owner.removeListener("hide", this.hide);
    this.owner.removeListener("closed", this.dispose);
    this.owner.webContents.removeListener("did-start-navigation", this.reset);
    this.owner.webContents.removeListener("render-process-gone", this.reset);
    this.closeBackdrop();
  };
}
