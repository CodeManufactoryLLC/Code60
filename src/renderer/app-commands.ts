import type { DesktopRun, Snapshot } from "../bridge/index.js";
import type { AppPagesProps } from "./app-page-props.js";
import { pageCommands } from "./navigation.js";
import type { Command } from "./overlays.js";
import { updateTabs } from "./tabs.js";
import type { TerminalSource } from "./terminal-source.js";

type CommandContext = Pick<
  AppPagesProps,
  | "api"
  | "busy"
  | "tabs"
  | "setTabs"
  | "setSettingsSection"
  | "preferences"
  | "fileAction"
  | "showPicker"
  | "attempt"
  | "notify"
> & {
  snapshot: Snapshot | undefined;
  database: string | null;
  directory: string | null | undefined;
  run: DesktopRun | undefined;
  sessionCommands(run: DesktopRun): Command[];
  setSetup(value: boolean): void;
  setExplorerOpen(value: boolean): void;
  terminalSource?: TerminalSource | undefined;
};
export function appCommands({
  api,
  busy,
  tabs,
  setTabs,
  setSettingsSection,
  preferences,
  fileAction,
  showPicker,
  attempt,
  notify,
  snapshot,
  database,
  directory,
  run,
  sessionCommands,
  setSetup,
  setExplorerOpen,
  terminalSource,
}: CommandContext): Command[] {
  const { theme, setTheme, signals, setSignals, charts, setCharts } = preferences;
  const settingsShortcut = navigator.platform.startsWith("Mac") ? "⌘," : "Ctrl+,";
  return [
    ...pageCommands(
      tabs.active,
      database,
      (id) => {
        if (id === "settings") setSettingsSection(null);
        if (id === "files") {
          fileAction({ type: "browse" });
          setExplorerOpen(true);
        }
        setTabs((current) => updateTabs(current, { type: "open", id }));
      },
      settingsShortcut,
    ),
    {
      id: "new",
      label: "New agent session",
      group: "Project",
      icon: "add",
      disabled: busy || !database || !directory,
      run: () => setSetup(true),
    },
    {
      id: "open-terminal",
      label: "Open terminal",
      group: "Project",
      icon: "terminal",
      disabled:
        busy ||
        !terminalSource?.target ||
        (terminalSource.target.kind !== "project" &&
          terminalSource.target.kind !== "project-worker"),
      run: () => {
        if (!terminalSource?.target) return;
        fileAction({
          type: "terminal",
          target: terminalSource.target,
          label: terminalSource.label,
        });
        setExplorerOpen(true);
        setTabs((current) => updateTabs(current, { type: "open", id: "chat" }));
      },
    },
    {
      id: "project",
      label: "Open project",
      group: "Project",
      icon: "document",
      disabled: busy || !database || Boolean(snapshot?.active),
      run: () => showPicker("project"),
    },
    {
      id: "database",
      label: "Connect to database",
      group: "Project",
      icon: "document",
      disabled: busy || Boolean(snapshot?.active),
      run: () => showPicker("database"),
    },
    {
      id: "refresh",
      label: "Poll project data",
      group: "Project",
      icon: "renew",
      disabled: busy || !database || !directory,
      run: () =>
        void attempt(() =>
          api.poll(["history", "config", "configurations"], {
            projectId: snapshot?.projectInstanceId ?? undefined,
            databaseEpoch: snapshot?.databaseEpoch,
          }),
        ).then((ok) => {
          if (ok) notify("Project data polled.", "info");
        }),
    },
    {
      id: "stop-all",
      label: "Stop all runs",
      group: "Project",
      icon: "stop",
      danger: true,
      disabled: busy || !snapshot?.active,
      run: () => void attempt(() => api.stopAll()),
    },
    ...(
      [
        ["light", "Light"],
        ["dark", "Dark"],
        ["system", "System"],
      ] as const
    ).map(
      ([id, label]): Command => ({
        id: `theme-${id}`,
        label: `Theme: ${label}`,
        group: "Appearance",
        icon: "light",
        checked: theme === id,
        run: () => setTheme(id),
      }),
    ),
    {
      id: "signals",
      label: "Signal colors",
      group: "Appearance",
      icon: "light",
      checked: signals,
      run: () => setSignals((value) => !value),
    },
    {
      id: "charts",
      label: "Inline charts in the sessions table",
      group: "Appearance",
      icon: "view",
      checked: charts,
      run: () => setCharts((value) => !value),
    },
    ...(run
      ? sessionCommands(run).map((command) => ({
          ...command,
          id: `session-${command.id}`,
          hint: `${run.record.agent} / ${run.record.id.slice(-6)}`,
        }))
      : []),
  ];
}
