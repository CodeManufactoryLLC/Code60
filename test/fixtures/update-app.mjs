// Exercise production update IPC and main-process preparation. Only native
// download/installation/relaunch and confirmation dialogs are simulated.
import childProcess from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { app, dialog } from "electron";

const require = createRequire(import.meta.url);
const directory = process.env.CODE60_TEST_SUPERVISOR_ROOT;
if (!directory || process.env.HOME !== join(directory, "home"))
  throw new Error("Update fixture requires isolated native supervision");
const evidence = join(directory, "installer-boundary.jsonl");
const record = (value) => appendFileSync(evidence, `${JSON.stringify(value)}\n`);
// Emulate the supported installed Linux target even on an ARM64 Docker host.
Object.defineProperty(process, "arch", { value: "x64" });
Object.defineProperty(app, "isPackaged", { value: true });
const updater = require("electron-updater").autoUpdater;
updater.checkForUpdates = async () => ({
  isUpdateAvailable: true,
  updateInfo: { version: "99.0.0" },
});
updater.downloadUpdate = async () => [join(directory, "fixture.deb")];
const originalExecFile = childProcess.execFile;
childProcess.execFile = function (file, args, options, callback) {
  if (file !== "/usr/bin/pkexec") return originalExecFile.call(this, file, args, options, callback);
  if (
    JSON.stringify(args) !== JSON.stringify(["/usr/bin/dpkg", "-i", join(directory, "fixture.deb")])
  )
    throw new Error("Unexpected native installer command");
  const marker = JSON.parse(
    readFileSync(join(directory, "state/code60/automations/update-restart.json"), "utf8"),
  );
  const oldPid = Number(readFileSync(join(directory, "old-service-pid"), "utf8"));
  let exited = false;
  try {
    process.kill(oldPid, 0);
  } catch (error) {
    if (error.code === "ESRCH") exited = true;
    else throw error;
  }
  if (!exited) throw new Error("Installer reached before old scheduler exited");
  record({ action: "install", marker, oldExited: exited });
  queueMicrotask(() => callback(null, "", ""));
};
syncBuiltinESMExports();
app.relaunch = () => record({ action: "relaunch" });
dialog.showMessageBox = async (options) => {
  record({
    action: "dialog",
    type: options.type,
    message: options.message,
    buttons: options.buttons,
    defaultId: options.defaultId,
    cancelId: options.cancelId,
  });
  if (options.message !== "Install update and restart Code60?")
    throw new Error("Unexpected fixture dialog");
  return { response: 1, checkboxChecked: false };
};
await import(resolve(import.meta.dirname, "../../dist/desktop/main.js"));
