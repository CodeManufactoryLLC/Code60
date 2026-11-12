import type { Dispatch, SetStateAction } from "react";
import type { Action, DesktopApi } from "../bridge/index.js";
import type { useAppPreferences } from "./app-preferences.js";
import type { FileTabAction } from "./file-tabs.js";
import type { FileBrowser } from "./files.js";
import type { ToastMessage, ToastTone } from "./overlays.js";
import type { useProjectScope } from "./project-scope.js";
import type { DesktopState } from "./snapshot-state.js";
import type { PageTabs, SettingsSectionId } from "./tabs.js";
import type { Transcripts } from "./transcripts.js";
import type { useUpdates } from "./updates.js";
import type { useWindowAppearance } from "./window-appearance.js";

export interface AppPagesProps {
  api: DesktopApi;
  state: DesktopState | undefined;
  project: ReturnType<typeof useProjectScope> & {
    explorerOpen: boolean;
    setExplorerOpen: Dispatch<SetStateAction<boolean>>;
    visitedRelayWorkers?: string[];
    explicitProjectFiles?: boolean;
  };
  preferences: ReturnType<typeof useAppPreferences>;
  appearance: ReturnType<typeof useWindowAppearance>;
  updates: ReturnType<typeof useUpdates>;
  tabs: PageTabs;
  settingsSection: SettingsSectionId;
  splash: boolean;
  busy: boolean;
  error: string;
  workerId: string | undefined;
  fileBrowser: FileBrowser;
  transcripts: Transcripts;
  orchestratorConfigured: boolean;
  setTabs: Dispatch<SetStateAction<PageTabs>>;
  setError(message: string): void;
  showPicker(kind: "database" | "project"): void;
  attempt(operation: () => Promise<unknown>, current?: () => boolean): Promise<boolean>;
  notify(text: string, tone?: ToastTone, action?: ToastMessage["action"]): void;
  openChat(id: string, compose?: boolean, eventIndex?: number): void;
  openReview(id: string): void;
  act(action: Action): Promise<boolean>;
  fileAction(action: FileTabAction): void;
  accept: (snapshot: import("../bridge/index.js").Snapshot) => void;
}
