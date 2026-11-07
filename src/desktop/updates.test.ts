import { EventEmitter } from "node:events";
import type { AppUpdater } from "electron-updater";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopUpdates } from "./updates.js";

const instances: DesktopUpdates[] = [];
function setup(
  options: { autoCheck?: boolean; saveAutoCheck?: (enabled: boolean) => Promise<void> } = {},
) {
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    disableWebInstaller: false,
    checkForUpdates: vi.fn(async () => ({
      isUpdateAvailable: true,
      updateInfo: { version: "0.3.0" },
    })),
    downloadUpdate: vi.fn(async (_token?: { cancel(): void }) => ["/cache/installer"]),
    quitAndInstall: vi.fn(),
  });
  const prepare = vi.fn(async () => true);
  const publish = vi.fn();
  const updates = new DesktopUpdates(
    updater as unknown as AppUpdater,
    publish,
    prepare,
    undefined,
    options,
  );
  instances.push(updates);
  return { updater, prepare, publish, updates };
}
afterEach(() => {
  for (const updates of instances.splice(0)) updates.close();
  vi.useRealTimers();
});

describe("desktop updates", () => {
  it("checks automatically after startup, never downloads, and does not replace available updates", async () => {
    vi.useFakeTimers();
    const { updater, updates } = setup();
    expect(updates.snapshot().autoCheck).toBe(true);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(updates.snapshot()).toMatchObject({ status: "available", version: "0.3.0" });
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4 * 60 * 60_000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });
  it("keeps automatic failures quiet and retries four hours later", async () => {
    vi.useFakeTimers();
    const { updater, updates } = setup();
    updater.checkForUpdates.mockRejectedValueOnce(new Error("private network failure"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(updates.snapshot()).toMatchObject({
      status: "idle",
      message: "Check for a new version of Code60.",
    });
    updater.checkForUpdates.mockResolvedValueOnce({
      isUpdateAvailable: false,
      updateInfo: { version: "0.2.0" },
    });
    await vi.advanceTimersByTimeAsync(4 * 60 * 60_000);
    expect(updates.snapshot().message).toContain("up to date");
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });
  it("persists the automatic-check switch, retains manual checks and stops timers on shutdown", async () => {
    vi.useFakeTimers();
    const saveAutoCheck = vi.fn(async (_enabled: boolean) => {});
    const { updater, updates } = setup({ autoCheck: false, saveAutoCheck });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect((await updates.action("auto-on")).autoCheck).toBe(true);
    expect(saveAutoCheck).toHaveBeenCalledWith(true);
    await updates.action("auto-off");
    await vi.advanceTimersByTimeAsync(4 * 60 * 60_000);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await updates.action("check");
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    await updates.action("auto-on");
    updates.close();
    await vi.advanceTimersByTimeAsync(5 * 60 * 60_000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
  });
  it("keeps the previous preference if saving fails", async () => {
    const { updates } = setup({
      saveAutoCheck: async () => {
        throw new Error("disk");
      },
    });
    await expect(updates.action("auto-off")).rejects.toThrow("disk");
    expect(updates.snapshot().autoCheck).toBe(true);
  });
  it("never overlaps automatic and manual checks or publishes after shutdown", async () => {
    vi.useFakeTimers();
    const { updates, updater, publish } = setup();
    let complete!: () => void;
    updater.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = () => resolve({ isUpdateAvailable: true, updateInfo: { version: "0.3.0" } });
        }),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(updates.action("check")).rejects.toThrow("in progress");
    await vi.advanceTimersByTimeAsync(8 * 60 * 60_000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    updates.close();
    const calls = publish.mock.calls.length;
    complete();
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("disables background download, quit-time install, web installers and downgrades", () => {
    const { updater, updates } = setup();
    expect(updates.snapshot().status).toBe("idle");
    expect(updater).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowDowngrade: false,
      disableWebInstaller: true,
    });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });
  it("requires an available update and completed download before installing", async () => {
    const { updates } = setup();
    await expect(updates.action("download")).rejects.toThrow("Check");
    await expect(updates.action("install")).rejects.toThrow("Download");
    expect((await updates.action("check")).status).toBe("available");
    expect((await updates.action("download")).status).toBe("ready");
  });
  it("installs only after confirmation and after agent cleanup completes", async () => {
    const { updates, updater, prepare } = setup();
    await updates.action("check");
    await updates.action("download");
    prepare.mockResolvedValueOnce(false);
    await updates.action("install");
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    let finish!: (value: boolean) => void;
    prepare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const install = updates.action("install");
    expect(updates.snapshot().status).toBe("installing");
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    await expect(updates.action("install")).rejects.toThrow("in progress");
    finish(true);
    await install;
    expect(updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true);
  });
  it("supports cancellation and retries without overlapping downloads", async () => {
    const { updates, updater } = setup();
    await updates.action("check");
    updater.downloadUpdate.mockImplementationOnce(
      (token) =>
        new Promise((_resolve, reject) => {
          if (!token) throw new Error("Missing cancellation token");
          const cancel = token.cancel.bind(token);
          token.cancel = () => {
            cancel();
            reject(new Error("cancelled"));
          };
        }),
    );
    const download = updates.action("download");
    updater.emit("download-progress", { percent: 42.6 });
    expect(updates.snapshot().percent).toBe(42);
    await expect(updates.action("check")).rejects.toThrow("in progress");
    updater.emit("error", new Error("network"));
    await expect(updates.action("download")).rejects.toThrow("in progress");
    await updates.action("cancel");
    await download;
    expect(updates.snapshot()).toMatchObject({ status: "available", percent: 0 });
    await updates.action("download");
    expect(updates.snapshot().status).toBe("ready");
  });
  it("bounds download time and stops in-flight work on shutdown", async () => {
    vi.useFakeTimers();
    const { updates, updater, publish } = setup();
    await updates.action("check");
    updater.downloadUpdate.mockImplementation(
      (token) =>
        new Promise((_resolve, reject) => {
          if (!token) throw new Error("Missing cancellation token");
          const cancel = token.cancel.bind(token);
          token.cancel = () => {
            cancel();
            reject(new Error("cancelled"));
          };
        }),
    );
    const first = updates.action("download");
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await first;
    expect(updates.snapshot().status).toBe("available");
    const second = updates.action("download");
    updates.close();
    const calls = publish.mock.calls.length;
    await second;
    updater.emit("download-progress", { percent: 100 });
    expect(publish).toHaveBeenCalledTimes(calls);
    await expect(updates.action("check")).rejects.toThrow("unavailable");
  });
  it("reports current versions and failures without leaking network errors", async () => {
    const { updates, updater, prepare } = setup();
    updater.checkForUpdates.mockResolvedValueOnce({
      isUpdateAvailable: false,
      updateInfo: { version: "0.2.0" },
    });
    expect((await updates.action("check")).message).toContain("up to date");
    updater.checkForUpdates.mockRejectedValueOnce(new Error("private path or token"));
    expect((await updates.action("check")).status).toBe("error");
    expect(updates.snapshot().message).not.toContain("private");
    await updates.action("check");
    updater.downloadUpdate.mockRejectedValueOnce(new Error("disk full"));
    expect((await updates.action("download")).status).toBe("error");
    await updates.action("check");
    await updates.action("download");
    prepare.mockRejectedValueOnce(new Error("agent cleanup failed"));
    expect((await updates.action("install")).status).toBe("ready");
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
  it("reports unsupported builds without contacting a server", async () => {
    const updates = new DesktopUpdates(null, vi.fn(), vi.fn());
    expect((await updates.action("status")).status).toBe("unavailable");
    await expect(updates.action("check")).rejects.toThrow("unavailable");
  });
  it("publishes monotonically revisioned state and retains downloaded updates on recheck", async () => {
    const { updates, publish, updater } = setup();
    await updates.action("check");
    await updates.action("download");
    await updates.action("check");
    expect(updates.snapshot().status).toBe("ready");
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    const revisions = publish.mock.calls.map(([state]) => state.revision);
    expect(revisions).toEqual([1, 2, 3, 4]);
  });
});
