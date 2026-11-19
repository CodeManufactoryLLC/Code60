import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { SidebarBackdrop } from "./sidebar-backdrop.js";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("electron", () => ({
  BaseWindow: function Backdrop(options: unknown) {
    return mocks.create(options);
  },
}));
afterEach(() => vi.clearAllMocks());

function setup() {
  let visible = false;
  let destroyed = false;
  const backdrop = {
    contentView: { setBackgroundColor: vi.fn() },
    isVisible: () => visible,
    isDestroyed: () => destroyed,
    showInactive: vi.fn(() => {
      visible = true;
    }),
    hide: vi.fn(() => {
      visible = false;
    }),
    close: vi.fn(() => {
      destroyed = true;
      visible = false;
    }),
    setBounds: vi.fn(),
    setOpacity: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    getMediaSourceId: () => "window:owned-backdrop:0",
  };
  mocks.create.mockReturnValue(backdrop);
  const owner = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), { getZoomFactor: () => 2 }),
    isDestroyed: () => false,
    isVisible: () => false, // Electron 45 macOS reports false for visible windows.
    isMinimized: () => false,
    getContentBounds: () => ({ x: 40, y: 60, width: 640, height: 480 }),
    moveAbove: vi.fn(),
  });
  const onError = vi.fn();
  const control = new SidebarBackdrop(owner as unknown as BrowserWindow, onError);
  return { control, owner, backdrop, onError };
}

it("creates no native window for disabled blur and bounds active blur to its owner", () => {
  const { control, owner, backdrop } = setup();
  control.update({ width: 244, strength: 0, visible: true });
  expect(mocks.create).not.toHaveBeenCalled();
  control.update({ width: 244, strength: 25, visible: true });
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      focusable: false,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      vibrancy: "sidebar",
      show: false,
    }),
  );
  expect(backdrop.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
  expect(backdrop.setBounds).toHaveBeenLastCalledWith({ x: 40, y: 60, width: 488, height: 480 });
  expect(backdrop.setOpacity).toHaveBeenLastCalledWith(0.25);
  expect(owner.moveAbove).toHaveBeenCalledWith("window:owned-backdrop:0");
  control.update({ width: 16384, strength: 100, visible: true });
  expect(backdrop.setBounds).toHaveBeenLastCalledWith({ x: 40, y: 60, width: 640, height: 480 });
  control.dispose();
});

it("hides on renderer navigation and disposes owned windows and listeners on owner close", () => {
  const { control, owner, backdrop } = setup();
  control.update({ width: 244, strength: 80, visible: true });
  owner.webContents.emit("did-start-navigation");
  expect(backdrop.hide).toHaveBeenCalled();
  control.update({ width: 244, strength: 80, visible: false });
  expect(backdrop.isVisible()).toBe(false);
  owner.emit("closed");
  expect(backdrop.close).toHaveBeenCalledOnce();
  expect(owner.listenerCount("move")).toBe(0);
  expect(owner.webContents.listenerCount("did-start-navigation")).toBe(0);
  control.dispose();
  control.update({ width: 244, strength: 80, visible: true });
  expect(mocks.create).toHaveBeenCalledOnce();
});

it("closes a failed native backdrop and surfaces a fixed error", () => {
  const { control, backdrop } = setup();
  backdrop.setBounds.mockImplementation(() => {
    throw new Error("native failure");
  });
  expect(() => control.update({ width: 244, strength: 50, visible: true })).toThrow(
    "Native sidebar blur is unavailable.",
  );
  expect(backdrop.close).toHaveBeenCalledOnce();
  control.dispose();
});

it("tracks owner hide/show independently of macOS isVisible and reports event failures", () => {
  const { control, owner, backdrop, onError } = setup();
  control.update({ width: 244, strength: 80, visible: true });
  expect(backdrop.isVisible()).toBe(true);
  owner.emit("hide");
  expect(backdrop.isVisible()).toBe(false);
  owner.emit("move");
  expect(backdrop.isVisible()).toBe(false);
  owner.emit("show");
  expect(backdrop.isVisible()).toBe(true);
  backdrop.setBounds.mockImplementation(() => {
    throw new Error("private native cause");
  });
  owner.emit("resize");
  expect(onError).toHaveBeenCalledExactlyOnceWith();
  expect(backdrop.close).toHaveBeenCalledOnce();
  control.dispose();
  expect(owner.listenerCount("show")).toBe(0);
  expect(owner.listenerCount("hide")).toBe(0);
});
