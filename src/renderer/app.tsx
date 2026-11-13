import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Action, DesktopApi, DesktopRun } from "../bridge/index.js";
import { useAppActions } from "./app-actions.js";
import { appCommands } from "./app-commands.js";
import { AppDialogs } from "./app-dialogs.js";
import { AppFooter } from "./app-footer.js";
import { AppMenus } from "./app-menus.js";
import { AppPages } from "./app-pages.js";
import { useAppPreferences } from "./app-preferences.js";
import { conversationId } from "./chats.js";
import { bindDatabaseWrites } from "./database-api.js";
import { DatabaseNotice } from "./database-notice.js";
import { useDesktopSnapshot } from "./desktop-snapshot.js";
import { useHistoryNavigation } from "./history-navigation.js";
import { pageAvailable } from "./navigation.js";
import {
  CommandPalette,
  maxToasts,
  type ToastMessage,
  Toasts,
  type ToastTone,
  Tooltips,
} from "./overlays.js";
import { PageTabBar } from "./page-tabs.js";
import { useProjectConnection } from "./project-connection.js";
import { useProjectWorkspace } from "./project-workspace.js";
import { useScopeLifetime } from "./scope-lifetime.js";
import { useScopedDetails } from "./scoped-details.js";
import { createSessionCommands } from "./session-commands.js";
import { hasOrchestrationProvider } from "./snapshot-state.js";
import { Splash } from "./splash.js";
import { useSplashEntry } from "./splash-entry.js";
import { initialTabs, type SettingsSectionId, updateTabs } from "./tabs.js";
import { useUpdateNotice, useUpdates } from "./updates.js";
import { useWindowAppearance } from "./window-appearance.js";

export function App({ api: transport }: { api: DesktopApi }) {
  const updates = useUpdates(transport);
  const [error, setError] = useState("");
  const { state: appState, accept } = useDesktopSnapshot(transport, setError);
  const [detailWorkerId, setDetailWorkerId] = useState<string>();
  const state = useScopedDetails(transport, appState, setError, detailWorkerId);
  const snapshot = state?.snapshot;
  const api = useMemo(
    () => bindDatabaseWrites(transport, snapshot?.databaseEpoch),
    [transport, snapshot?.databaseEpoch],
  );
  const appearance = useWindowAppearance(transport, setError);

  const [palette, setPalette] = useState(false);
  const [notifications, setNotifications] = useState<ToastMessage[]>([]);
  const notificationId = useRef(0);
  const notify = (text: string, tone: ToastTone = "success", action?: ToastMessage["action"]) =>
    setNotifications((current) => [
      ...current.slice(-(maxToasts - 1)),
      { id: ++notificationId.current, text, tone, action },
    ]);
  const dismissNotification = useCallback(
    (id: number) => setNotifications((current) => current.filter((item) => item.id !== id)),
    [],
  );
  const { busy, attempt, setBusy } = useAppActions(setError);
  const preferences = useAppPreferences(transport, setError);
  const { theme, setTheme } = preferences;
  const [tabs, setTabs] = useState(initialTabs);
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("agents");
  const { splash, splashReady, enterApp, returnSplash } = useSplashEntry(snapshot);
  const returnToSplash = () => {
    returnSplash();
    setPicker(undefined);
    setProjectChoice(undefined);
    setError("");
  };
  const updateNotice = useUpdateNotice(updates.state, !splash && !busy);
  const openUpdates = () => {
    setSettingsSection("updates");
    setTabs((current) => updateTabs(current, { type: "select", id: "settings" }));
    requestAnimationFrame(() =>
      document.getElementById("app-updates")?.scrollIntoView({ block: "center" }),
    );
  };
  const orchestratorConfigured = hasOrchestrationProvider(snapshot);
  const database = snapshot?.database ?? null;
  const databaseScope = useScopeLifetime(
    JSON.stringify(["database", database, state?.databaseGeneration ?? 0]),
  );
  const directory = snapshot?.directory;
  const {
    project,
    workerId,
    fileBrowser,
    transcripts,
    selectWorker,
    openChat,
    fileAction,
    browseFiles,
    resume,
    openReview,
    reviewRun,
  } = useProjectWorkspace({
    api,
    state,
    tabs,
    splash,
    setTabs,
    setError,
    notify,
    setBusy,
    onWorkerSelection: setDetailWorkerId,
    // Defined below, once the workspace's worker selection exists; called only after render.
    onChatNavigation: (request) => history.expectChat(request),
  });
  const {
    scope,
    selected,
    setSelected,
    setSetup,
    setConfigurationMenu,
    setWorktreeMenu,
    setPollMenu,
    setMenu,
    setExplorerOpen,
    chatRequest,
  } = project;
  const closeMenus = () => {
    setMenu(undefined);
    setConfigurationMenu(undefined);
    setPollMenu(undefined);
    setWorktreeMenu(undefined);
  };
  const history = useHistoryNavigation({
    api,
    snapshot,
    tabs,
    settingsSection,
    workerId,
    setTabs,
    setSettingsSection,
    closeMenus,
    selectWorker,
    openChat,
    setError,
  });
  const databaseLoaded = snapshot !== undefined;
  useEffect(() => {
    if (!databaseLoaded || database) return;
    setTabs((current) =>
      pageAvailable(current.active, database)
        ? current
        : updateTabs(current, { type: "select", id: "chat" }),
    );
  }, [database, databaseLoaded]);
  const run = snapshot?.runs.find((item) => item.record.id === selected);

  useLayoutEffect(() => {
    // Finish navigation focus before another interaction can focus a control or open a modal.
    if (
      !splash &&
      !(tabs.active === "settings" && document.activeElement?.id.startsWith("tab-settings-"))
    )
      document.getElementById(`tab-${tabs.active}`)?.focus();
  }, [tabs.active, splash]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      // Dialogs keep their own state, so the shortcut waits until none is open.
      if (splash || document.querySelector("dialog[open]")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMenu(undefined);
        setWorktreeMenu(undefined);
        setPalette(true);
      } else if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setMenu(undefined);
        setWorktreeMenu(undefined);
        setTabs((current) => updateTabs(current, { type: "open", id: "settings" }));
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [splash, setMenu, setWorktreeMenu]);

  const projectAttempt = (operation: () => Promise<unknown>) => attempt(operation, scope.capture());
  const databaseAttempt = (operation: () => Promise<unknown>) =>
    attempt(operation, databaseScope.capture());
  const act = (action: Action) => projectAttempt(() => api.action(action));
  const connection = useProjectConnection({
    api,
    state,
    busy,
    attempt,
    notify,
    accept,
    setError,
    orchestratorConfigured,
    enterApp,
  });
  const { setPicker, setProjectChoice, showPicker } = connection;
  const sessionCommands = (target: DesktopRun) =>
    createSessionCommands(target, {
      busy,
      directory,
      act,
      openChat,
      browseFiles,
      reviewRun,
      resume,
      setSelected,
    });
  const commands = appCommands({
    api,
    busy,
    tabs,
    setTabs,
    preferences,
    fileAction,
    showPicker,
    attempt: projectAttempt,
    notify,
    snapshot,
    database,
    directory,
    run,
    sessionCommands,
    setSetup,
    setExplorerOpen,
  });
  return (
    <div className="app">
      <Tooltips />
      <Toasts messages={notifications} onDismiss={dismissNotification} />
      <AppMenus
        state={state}
        project={project}
        api={api}
        busy={busy}
        attempt={projectAttempt}
        setError={setError}
        setTabs={setTabs}
        browseFiles={browseFiles}
        setSettingsSection={setSettingsSection}
        sessionCommands={sessionCommands}
      />
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
      {splash && (
        <Splash
          ready={splashReady && (snapshot !== undefined || error !== "")}
          snapshot={snapshot}
          api={api}
          busy={busy}
          error={error}
          theme={theme}
          onThemeChange={setTheme}
          onConnectDatabase={() => showPicker("database")}
          onEnter={() => {
            if (!orchestratorConfigured) return;
            enterApp();
          }}
        />
      )}
      {!splash && <div className="window-drag-strip" aria-hidden="true" />}
      {!splash && snapshot && !database && (
        <DatabaseNotice
          busy={busy}
          error={snapshot.databaseError}
          onConnect={() => showPicker("database")}
        />
      )}
      <div className="app-workspace" data-chat={!splash && tabs.active === "chat"}>
        {!splash && (
          <PageTabBar
            tabs={tabs}
            settingsSection={settingsSection}
            api={api}
            openProjects={snapshot?.openProjects}
            selectedProjectId={snapshot?.projectInstanceId}
            chats={snapshot?.chats ?? []}
            selectedId={workerId ?? (snapshot && conversationId(snapshot.chat))}
            navigationSerial={chatRequest?.serial}
            runs={[
              ...new Map(
                [
                  ...Object.values(state?.projectViews ?? {}).flatMap((view) => view.runs),
                  ...(snapshot?.runs ?? []),
                ].map((run) => [run.record.id, run]),
              ).values(),
            ]}
            onWorkerSelect={selectWorker}
            database={database}
            eventsByRun={{ ...transcripts.events, ...state?.chatEventsByRun }}
            onOpenProject={() => showPicker("project")}
            onChatArchived={() => notify("Chat archived.")}
            onConnectDatabase={() => showPicker("database")}
            onSettingsSectionSelect={setSettingsSection}
            projectDisabled={
              busy || !snapshot || Boolean(snapshot.active && !snapshot.openProjects)
            }
            onSelect={(id) => {
              closeMenus();
              setTabs((current) => updateTabs(current, { type: "select", id }));
            }}
            onChatNavigation={history.expectChat}
            canGoBack={history.canGoBack}
            canGoForward={history.canGoForward}
            onBack={history.back}
            onForward={history.forward}
          />
        )}
        <AppPages
          updates={updates}
          api={api}
          state={state}
          project={project}
          preferences={preferences}
          appearance={appearance}
          tabs={tabs}
          settingsSection={settingsSection}
          splash={splash}
          busy={busy}
          error={error}
          workerId={workerId}
          fileBrowser={fileBrowser}
          transcripts={transcripts}
          orchestratorConfigured={orchestratorConfigured}
          setTabs={setTabs}
          setError={setError}
          showPicker={showPicker}
          attempt={databaseAttempt}
          notify={notify}
          openChat={openChat}
          openReview={openReview}
          openRelay={async () => {
            const relay = snapshot?.chats.find((chat) => chat.kind === "relay");
            const id = relay && conversationId(relay);
            if (!id) throw new Error("Relay is unavailable. Try again shortly.");
            await api.orchestrationChatAction({ type: "select", id });
            selectWorker(undefined, null);
            setTabs((current) => updateTabs(current, { type: "select", id: "chat" }));
          }}
          act={act}
          fileAction={fileAction}
          accept={accept}
        />
      </div>
      {!splash && (
        <AppFooter
          api={api}
          state={state}
          transcripts={transcripts}
          tabs={tabs}
          workerId={workerId}
          busy={busy}
          showPicker={showPicker}
          openChat={openChat}
          updates={updates}
          openUpdates={openUpdates}
          onReturn={returnToSplash}
        />
      )}
      <AppDialogs
        api={api}
        state={state}
        project={project}
        busy={busy}
        error={error}
        setError={setError}
        attempt={projectAttempt}
        notify={notify}
        updates={updates}
        orchestratorConfigured={orchestratorConfigured}
        connection={connection}
        updateNotice={updateNotice}
        openUpdates={openUpdates}
      />
    </div>
  );
}
