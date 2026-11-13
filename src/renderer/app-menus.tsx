import type { DesktopRun } from "../bridge/index.js";
import { ActionsMenu } from "./actions-menu.js";
import type { AppPagesProps } from "./app-page-props.js";
import type { Command } from "./overlays.js";
import { labels as pollLabels } from "./polling.js";
import { updateTabs } from "./tabs.js";

type MenusProps = Pick<
  AppPagesProps,
  "state" | "project" | "api" | "busy" | "attempt" | "setError" | "setTabs"
> & {
  browseFiles(): Promise<void>;
  setSettingsSection(section: import("./tabs.js").SettingsSectionId): void;
  sessionCommands(run: DesktopRun): Command[];
};
export function AppMenus({
  state,
  project,
  api,
  busy,
  attempt,
  setError,
  setTabs,
  browseFiles,
  setSettingsSection,
  sessionCommands,
}: MenusProps) {
  const snapshot = state?.snapshot;
  const {
    scope,
    menu,
    configurationMenu,
    worktreeMenu,
    pollMenu,
    setConfigurationEditor,
    setConfigurationMenu,
    setWorktreeMenu,
    setPollMenu,
    setMenu,
  } = project;
  const workspace = scope.workspace;
  const menuRun = snapshot?.runs.find((item) => item.record.id === menu?.id);
  const menuConfiguration = snapshot?.configurations.find(
    (entry) => entry.id === configurationMenu?.id,
  );
  const menuWorktree =
    worktreeMenu?.workspace === workspace
      ? snapshot?.worktrees?.worktrees.find((entry) => entry.path === worktreeMenu.id)
      : undefined;
  const menuSource = snapshot?.polling.sources.find((source) => source.key === pollMenu?.id);

  return (
    <>
      {/* Menus render outside page panels, which clip their contents. */}
      {configurationMenu && menuConfiguration && (
        <ActionsMenu
          bounds={configurationMenu.bounds}
          label={`Actions for ${menuConfiguration.name}`}
          groups={[
            [
              {
                label: "Edit",
                icon: "document",
                disabled: busy,
                reason: "Wait for the current action to finish",
                run: () => {
                  setError("");
                  setConfigurationEditor(menuConfiguration);
                },
              },
            ],
            [
              {
                label: "Delete",
                icon: "trash-can",
                disabled: busy,
                reason: "Wait for the current action to finish",
                danger: true,
                run: () => void attempt(() => api.deleteConfiguration(menuConfiguration.id)),
              },
            ],
          ]}
          onClose={() => setConfigurationMenu(undefined)}
        />
      )}
      {worktreeMenu && menuWorktree && (
        <ActionsMenu
          bounds={worktreeMenu.bounds}
          label={`Actions for ${menuWorktree.path}`}
          groups={[
            [
              {
                label: "Browse project files",
                icon: "document",
                disabled: busy,
                reason: "Wait for the current action to finish",
                run: () => void browseFiles(),
              },
            ],
          ]}
          onClose={() => setWorktreeMenu(undefined)}
        />
      )}
      {pollMenu && menuSource && (
        <ActionsMenu
          bounds={pollMenu.bounds}
          label={`Actions for ${pollLabels[menuSource.key]}`}
          groups={[
            [
              {
                label: "Poll now",
                icon: "renew",
                disabled: busy || menuSource.status === "unavailable",
                reason: busy
                  ? "Wait for the current action to finish"
                  : "Open a project to poll this source",
                run: () =>
                  void attempt(() =>
                    api.poll([menuSource.key], {
                      projectId: snapshot?.projectInstanceId ?? undefined,
                      databaseEpoch: snapshot?.databaseEpoch,
                    }),
                  ),
              },
            ],
            [
              {
                label: "Polling settings",
                icon: "settings",
                disabled: false,
                run: () => {
                  setSettingsSection("polling-settings");
                  setTabs((current) => updateTabs(current, { type: "open", id: "settings" }));
                },
              },
            ],
          ]}
          onClose={() => setPollMenu(undefined)}
        />
      )}
      {menu && menuRun && (
        <ActionsMenu
          bounds={menu.bounds}
          label={`Actions for ${menuRun.record.agent} / ${menuRun.record.id.slice(-6)}`}
          groups={(() => {
            const items = sessionCommands(menuRun).map((command) => ({
              label: command.label,
              icon: command.icon ?? "document",
              disabled: command.disabled ?? false,
              reason: command.reason,
              danger: command.danger,
              run: command.run,
              id: command.id,
            }));
            const pick = (ids: string[]) => items.filter((item) => ids.includes(item.id));
            return [
              pick(["chat", "review", "browse"]),
              pick(["cancel", "finish", "resume", "stop"]),
              pick(["discard"]),
            ];
          })()}
          onClose={() => setMenu(undefined)}
        />
      )}
    </>
  );
}
