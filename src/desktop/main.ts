import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
} from "electron";
import {
  CODE60_COPYRIGHT,
  type MenuCommand,
  parseAction,
  parseBoolean,
  parseConfigurationId,
  parseDatabaseMode,
  parseFileContext,
  parseMemoryExtraction,
  parseMemoryRequestId,
  parseOrchestrationChatAction,
  parseOrchestrationProvider,
  parsePollKeys,
  parsePollSettings,
  parsePollVisibility,
  parseProjectPath,
  parsePromptTemplateId,
  parseSaveConfiguration,
  parseSavePromptTemplate,
  parseStart,
} from "../bridge/index.js";
import { defaultDeps, stateHome } from "../core/index.js";
import { DesktopController } from "./controller.js";
import { filePreferences } from "./preferences.js";
import { openProjectDatabase } from "./projects.js";

const here = dirname(fileURLToPath(import.meta.url));
const page = pathToFileURL(join(here, "../renderer/index.html")).href;
let window: BrowserWindow | undefined;
let exiting = false;
let quitPending = false;
const databaseFilters = [{ name: "SQLite database", extensions: ["sqlite", "sqlite3", "db"] }];
const preferences = filePreferences(join(stateHome(process.env), "code60", "desktop.json"));
const controller = new DesktopController(
  defaultDeps(),
  process.env,
  {
    async confirm(title, detail) {
      const result = await dialog.showMessageBox({
        type: "warning",
        title,
        message: title,
        detail,
        buttons: ["Cancel", "Confirm"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
  },
  {
    openDatabase: openProjectDatabase,
    preferences,
  },
);

async function quit(confirm: boolean): Promise<void> {
  if (quitPending) return;
  quitPending = true;
  try {
    if (confirm && controller.hasActiveWork) {
      const result = await dialog.showMessageBox({
        type: "warning",
        message: "Stop all agents and quit?",
        detail: "Active turns will be cancelled and idle sessions finished. Worktrees are kept.",
        buttons: ["Keep working", "Stop and quit"],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response !== 1) return;
    }
    await controller.shutdown();
    exiting = true;
    app.quit();
  } catch {
    await dialog.showMessageBox({
      type: "error",
      message: "Could not stop all agents. Try quitting again.",
    });
  } finally {
    quitPending = false;
  }
}

function trusted(event: IpcMainInvokeEvent): void {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== page
  )
    throw new Error("Untrusted desktop request");
}

function handle(channel: string, action: (value: unknown) => unknown): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    trusted(event);
    if (args.length > 1) throw new Error("Invalid request");
    return action(args[0]);
  });
}

function menu(command: MenuCommand): void {
  if (!window || window.isDestroyed()) return;
  window.show();
  window.webContents.send("desktop:menu", command);
}

function applicationMenu(): Menu {
  const mac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [
    // macOS shows the running bundle's name as the bold menu title; unpackaged, that is "Electron".
    mac
      ? { id: "app", label: "Code60", role: "appMenu" }
      : {
          id: "app",
          label: "Code60",
          submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
        },
    {
      label: "File",
      submenu: [
        {
          id: "open-project",
          label: "Open Project…",
          accelerator: "CmdOrCtrl+O",
          enabled: false,
          click: () => menu("open-project"),
        },
        ...(mac ? [{ type: "separator" as const }, { role: "close" as const }] : []),
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        ...(mac ? [{ role: "pasteAndMatchStyle" as const }] : []),
        { role: "delete" },
        { role: "selectAll" },
        { type: "separator" },
        { id: "database", label: "Database Connection…", click: () => menu("database") },
      ],
    },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}

app.setName("Code60");
app.setAboutPanelOptions({
  applicationName: "Code60",
  applicationVersion: app.getVersion(),
  version: app.getVersion(),
  copyright: CODE60_COPYRIGHT,
});
app.on("before-quit", (event) => {
  if (exiting) return;
  event.preventDefault();
  void quit(true);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (quitPending) void controller.shutdown(true);
    else void quit(false);
  });
}

// Avoid top-level await here: Electron automation attaches only after the main module finishes loading.
async function ready(): Promise<void> {
  const transparent = await preferences.transparent();
  let enabled = transparent;
  const clickThrough = transparent && process.platform === "darwin";
  Menu.setApplicationMenu(applicationMenu());
  handle("desktop:window-appearance", (value) => {
    if (value !== undefined) throw new Error("Invalid request");
    return { transparent, enabled, clickThrough };
  });
  handle("desktop:transparent", async (value) => {
    const next = parseBoolean(value);
    await preferences.setTransparent(next);
    enabled = next;
  });
  handle("desktop:background-hit-test", (value) => {
    const ignore = parseBoolean(value);
    if (clickThrough) window?.setIgnoreMouseEvents(ignore, { forward: true });
  });
  handle("desktop:snapshot", () => controller.snapshot());
  handle("desktop:database", async (value) => {
    const mode = parseDatabaseMode(value);
    if (controller.active) throw new Error("Finish or stop all runs before switching databases");
    const path =
      mode === "create"
        ? (
            await dialog.showSaveDialog({
              title: "Create database",
              defaultPath: "code60.sqlite",
              filters: databaseFilters,
              properties: ["createDirectory", "showOverwriteConfirmation"],
            })
          ).filePath
        : (
            await dialog.showOpenDialog({
              title: "Open database",
              properties: ["openFile"],
              filters: databaseFilters,
            })
          ).filePaths[0];
    if (!path) return false;
    await controller.connect(path, mode === "create");
    return true;
  });
  handle("desktop:folder", async () => {
    if (!controller.connected) throw new Error("Connect to a database first");
    if (controller.active) throw new Error("Finish or stop all runs before switching folders");
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Open project",
    });
    if (result.canceled || !result.filePaths[0]) return false;
    await controller.open(result.filePaths[0]);
    return true;
  });
  handle("desktop:project", (value) => controller.openProject(parseProjectPath(value)));
  handle("desktop:project-remove", (value) => controller.removeProject(parseProjectPath(value)));
  handle("desktop:project-clear", (value) => {
    if (value !== undefined) throw new Error("Invalid request");
    return controller.clearProjects();
  });
  handle("desktop:files", (value) => controller.setFileContext(parseFileContext(value)));
  handle("desktop:poll", (value) => controller.poll(parsePollKeys(value)));
  handle("desktop:poll-settings", (value) => controller.setPollSettings(parsePollSettings(value)));
  handle("desktop:poll-paused", (value) => controller.setPollingPaused(parseBoolean(value)));
  handle("desktop:visibility", (value) => controller.setVisibility(parsePollVisibility(value)));
  handle("desktop:orchestration-chat", (value) =>
    controller.orchestrationChatAction(parseOrchestrationChatAction(value)),
  );
  handle("desktop:orchestration-provider", (value) =>
    controller.setOrchestrationProvider(parseOrchestrationProvider(value)),
  );
  handle("desktop:orchestration-test", (value) => {
    if (value !== undefined) throw new Error("Invalid request");
    return controller.testOrchestrationProvider();
  });
  handle("desktop:orchestration-test-cancel", (value) => {
    if (value !== undefined) throw new Error("Invalid request");
    return controller.cancelOrchestrationTest();
  });
  handle("desktop:memory-extract", (value) =>
    controller.extractMemory(parseMemoryExtraction(value)),
  );
  handle("desktop:memory-cancel", (value) =>
    controller.cancelMemoryExtraction(parseMemoryRequestId(value)),
  );
  handle("desktop:start", (value) => controller.start(parseStart(value)));
  handle("desktop:configuration-save", (value) =>
    controller.saveConfiguration(parseSaveConfiguration(value)),
  );
  handle("desktop:configuration-delete", (value) =>
    controller.deleteConfiguration(parseConfigurationId(value)),
  );
  handle("desktop:prompt-save", (value) =>
    controller.savePromptTemplate(parseSavePromptTemplate(value)),
  );
  handle("desktop:prompt-reset", (value) =>
    controller.resetPromptTemplate(parsePromptTemplateId(value)),
  );
  handle("desktop:action", (value) => controller.action(parseAction(value)));
  handle("desktop:stop-all", async () => {
    const result = await dialog.showMessageBox({
      type: "warning",
      message: "Stop all runs?",
      detail: "Active turns will be cancelled and idle sessions finished. Worktrees are kept.",
      buttons: ["Keep working", "Stop all"],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response === 1) await controller.stopAll();
  });
  void controller.restore();
  controller.subscribe((snapshot) => {
    // Mirrors the renderer's rule for opening projects: a database is connected and no batch is active.
    const openProject = Menu.getApplicationMenu()?.getMenuItemById("open-project");
    if (openProject) openProject.enabled = snapshot.database !== null && !snapshot.active;
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send("desktop:update", snapshot);
  });

  window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 820,
    minHeight: 600,
    title: `Code60 - ${app.getVersion()}`,
    transparent,
    backgroundColor: transparent ? "#00000000" : "#111318",
    hasShadow: !transparent,
    // The window controls sit over the renderer's dedicated drag strip.
    titleBarStyle: "hidden",
    titleBarOverlay: { height: 28 },
    ...(process.platform === "darwin" ? { trafficLightPosition: { x: 18, y: 7 } } : {}),
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Keep the versioned title instead of the page's <title>.
  window.on("page-title-updated", (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => {
    if (event.url !== page) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("render-process-gone", () => void quit(false));
  window.webContents.on("did-start-loading", () => {
    window?.setIgnoreMouseEvents(false);
    controller.setVisibility({ visible: false, worktrees: false });
  });
  window.on("close", (event) => {
    if (exiting) return;
    event.preventDefault();
    void quit(true);
  });
  window.loadURL(page).catch(() => void quit(false));
}

app
  .whenReady()
  .then(ready)
  .catch(() => app.exit(1));
