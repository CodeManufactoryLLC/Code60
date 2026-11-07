import updaterPackage, { type AppUpdater } from "electron-updater";
import type { UpdateAction, UpdateState } from "../bridge/index.js";
import { Poller } from "./poller.js";

type Updater = Pick<
  AppUpdater,
  | "on"
  | "checkForUpdates"
  | "downloadUpdate"
  | "quitAndInstall"
  | "autoDownload"
  | "autoInstallOnAppQuit"
  | "allowDowngrade"
  | "disableWebInstaller"
  | "logger"
>;

/** Updates never download or install without an explicit user action. */
export class DesktopUpdates {
  private state: UpdateState;
  private token: InstanceType<typeof updaterPackage.CancellationToken> | undefined;
  private closed = false;
  private downloaded: string | undefined;
  private stopChecks: (() => void) | undefined;

  constructor(
    private readonly updater: Updater | null,
    private readonly publish: (state: UpdateState) => void,
    private readonly prepareInstall: () => Promise<boolean>,
    private readonly install: (file: string) => Promise<void> = async () => {
      updater?.quitAndInstall(false, true);
    },
    private readonly options: {
      autoCheck?: boolean;
      saveAutoCheck?: (enabled: boolean) => Promise<void>;
    } = {},
  ) {
    this.state = {
      revision: 0,
      status: updater ? "idle" : "unavailable",
      version: null,
      percent: 0,
      autoCheck: options.autoCheck ?? true,
      message: updater
        ? "Check for a new version of Code60."
        : "Updates require an installed release build on a supported platform.",
    };
    if (!updater) return;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.disableWebInstaller = true;
    updater.logger = null;
    updater.on("error", () => {
      if (this.state.status === "checking" || this.state.status === "downloading") return;
      if (!this.token?.cancelled)
        this.set(
          "error",
          "Update failed. Check your connection and installation permissions, then try again.",
        );
    });
    updater.on("download-progress", ({ percent }) => {
      if (this.state.status !== "downloading" || this.token?.cancelled) return;
      const next = Math.max(0, Math.min(100, Math.floor(percent)));
      if (Number.isFinite(next) && next !== this.state.percent)
        this.set("downloading", `Downloading Code60 ${this.state.version}…`, { percent: next });
    });
    this.scheduleChecks();
  }

  private scheduleChecks(): void {
    this.stopChecks?.();
    this.stopChecks = undefined;
    if (!this.closed && this.updater && this.state.autoCheck)
      this.stopChecks = Poller.scheduleUpdateChecks(async () => {
        if (!this.closed && this.state.autoCheck && this.state.status === "idle")
          await this.check(true);
      });
  }

  private async check(quiet = false): Promise<void> {
    const previous = this.snapshot();
    this.set("checking", "Checking for updates…", { percent: 0, version: null });
    try {
      const result = await this.updater?.checkForUpdates();
      if (!result) throw new Error("Updater disabled");
      this.set(
        result.isUpdateAvailable ? "available" : "idle",
        result.isUpdateAvailable
          ? `Code60 ${result.updateInfo.version} is available.`
          : "Code60 is up to date.",
        { version: result.isUpdateAvailable ? result.updateInfo.version : null },
      );
    } catch {
      if (quiet) this.set(previous.status, previous.message, { version: previous.version });
      else this.set("error", "Could not check for updates. Check your connection and try again.");
    }
  }

  snapshot(): UpdateState {
    return { ...this.state };
  }

  private set(
    status: UpdateState["status"],
    message: string,
    patch: Partial<UpdateState> = {},
  ): void {
    if (this.closed) return;
    this.state = { ...this.state, ...patch, status, message, revision: this.state.revision + 1 };
    this.publish(this.snapshot());
  }

  async action(action: UpdateAction): Promise<UpdateState> {
    if (action === "status") return this.snapshot();
    if (!this.closed && (action === "auto-on" || action === "auto-off")) {
      const enabled = action === "auto-on";
      await this.options.saveAutoCheck?.(enabled);
      this.set(this.state.status, this.state.message, { autoCheck: enabled });
      this.scheduleChecks();
      return this.snapshot();
    }
    if (this.closed || !this.updater) throw new Error("Updates are unavailable");
    if (action === "cancel") {
      if (this.state.status === "downloading") this.token?.cancel();
      return this.snapshot();
    }
    if (["checking", "downloading", "installing"].includes(this.state.status))
      throw new Error("An update operation is already in progress");
    if (action === "check") {
      if (this.state.status === "ready") return this.snapshot();
      await this.check();
    } else if (action === "download") {
      if (this.state.status !== "available") throw new Error("Check for an update first");
      const token = new updaterPackage.CancellationToken();
      this.token = token;
      this.set("downloading", `Downloading Code60 ${this.state.version}…`, { percent: 0 });
      const deadline = setTimeout(() => token.cancel(), 30 * 60_000);
      try {
        const files = await this.updater.downloadUpdate(token);
        if (!token.cancelled && !files[0]) throw new Error("No downloaded installer");
        this.downloaded = files[0];
        this.set(
          token.cancelled ? "available" : "ready",
          token.cancelled
            ? "Download cancelled. You can try again."
            : `Code60 ${this.state.version} is ready to install.`,
          { percent: token.cancelled ? 0 : 100 },
        );
      } catch {
        this.set(
          token.cancelled ? "available" : "error",
          token.cancelled
            ? "Download cancelled. You can try again."
            : "Download failed. Check your connection and free disk space, then check for updates again.",
          { percent: 0 },
        );
      } finally {
        clearTimeout(deadline);
        this.token = undefined;
      }
    } else if (action === "install") {
      if (this.state.status !== "ready" || !this.downloaded)
        throw new Error("Download an update first");
      this.set("installing", "Preparing to install and restart…");
      try {
        if ((await this.prepareInstall()) && !this.closed) await this.install(this.downloaded);
        else this.set("ready", `Code60 ${this.state.version} is ready to install.`);
      } catch {
        this.set(
          "ready",
          "Could not install the update. Check installation permissions and try again.",
        );
      }
    }
    return this.snapshot();
  }

  close(): void {
    this.closed = true;
    this.stopChecks?.();
    this.token?.cancel();
  }
}
