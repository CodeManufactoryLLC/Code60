import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Action, DesktopApi, DesktopRun } from "../bridge/index.js";
import { AgentSetupWizard } from "./agent-setup.js";
import { useAppActions } from "./app-actions.js";
import { appCommands } from "./app-commands.js";
import { AppDialogs } from "./app-dialogs.js";
import { AppFooter } from "./app-footer.js";
import { AppMenus } from "./app-menus.js";
import { AppPages } from "./app-pages.js";
import { useAppPreferences } from "./app-preferences.js";
import { builtinRelayId, conversationId } from "./chats.js";
import { bindDatabaseWrites } from "./database-api.js";
import { DatabaseNotice } from "./database-notice.js";
import { useDesktopSnapshot } from "./desktop-snapshot.js";
import { useHistoryNavigation } from "./history-navigation.js";
import { useKnowledgeNavigation } from "./knowledge-report.js";
import { pageAvailable } from "./navigation.js";
import { useNavigationActions } from "./navigation-actions.js";
import { focusNavigation } from "./navigation-focus.js";
import { isNavigationHome, sidebarPageElementId } from "./navigation-tree.js";
import {
  CommandPalette,
  maxToasts,
  type ToastMessage,
  Toasts,
  type ToastTone,
  Tooltips,
} from "./overlays.js";
import { PageTabBar } from "./page-tabs.js";
import { usePressFeedback } from "./press-feedback.js";
import { useProjectConnection } from "./project-connection.js";
import { useProjectWorkspace } from "./project-workspace.js";
import { useProviderManagement } from "./provider-management.js";
import { useScopeLifetime } from "./scope-lifetime.js";
import { useScopedDetails } from "./scoped-details.js";
import { createSessionCommands } from "./session-commands.js";
import { useSidebarBackdrop } from "./sidebar-backdrop.js";
import { hasOrchestrationProvider } from "./snapshot-state.js";
import { Splash } from "./splash.js";
import { useSplashEntry } from "./splash-entry.js";
import { initialTabs, type SettingsSectionId, updateTabs } from "./tabs.js";
import { useUpdateNotice, useUpdates } from "./updates.js";
import { useWindowAppearance } from "./window-appearance.js";
import { WindowControls } from "./window-controls.js";

export function App({ api: transport }: { api: DesktopApi }) {
  usePressFeedback();
  const updates = useUpdates(transport);
  const [error, setError] = useState("");
  const { state: appState, accept } = useDesktopSnapshot(transport, setError);
  const [detailWorkerId, setDetailWorkerId] = useState<string>();
  const [tabs, setTabs] = useState(initialTabs);
  const projectNavigationPending = useRef(false);
  const state = useScopedDetails(
    transport,
    appState,
    setError,
    detailWorkerId,
    !isNavigationHome(tabs.active) && !projectNavigationPending.current,
  );
  const snapshot = state?.snapshot;
  const api = useMemo(
    () => bindDatabaseWrites(transport, snapshot?.databaseEpoch),
    [transport, snapshot?.databaseEpoch],
  );
  const providerManagement = useProviderManagement(api, snapshot);
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
  const preferences = useAppPreferences();
  const { theme, setTheme } = preferences;
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId | null>(null);
  const { splash, splashReady, enterApp, returnSplash } = useSplashEntry(snapshot);
  const sidebarBlurError = useSidebarBackdrop(
    transport,
    preferences.sidebarAppearance,
    appearance.sidebarBlurSupported,
    splash,
  );
  const controlWindow = (action: import("../bridge/index.js").WindowControl) => {
    void transport
      .controlWindow(action)
      .catch(() => setError("The window action could not be completed."));
  };
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
    navigationPending: projectNavigationPending.current,
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
  useKnowledgeNavigation(transport, {
    page: tabs.active,
    settingsSection,
    splash,
    workerId,
    theme,
  });
  const navigationRuns = useMemo(
    () => [
      ...new Map(
        [
          ...Object.values(state?.projectViews ?? {}).flatMap((view) => view.runs),
          ...(snapshot?.runs ?? []),
        ].map((run) => [run.record.id, run]),
      ).values(),
    ],
    [state?.projectViews, snapshot?.runs],
  );
  const navigationSelectedId = workerId ?? (snapshot && conversationId(snapshot.chat));
  const selectPage = (id: import("./navigation.js").PageId) => {
    setMenu(undefined);
    setConfigurationMenu(undefined);
    setPollMenu(undefined);
    setWorktreeMenu(undefined);
    setTabs((current) => updateTabs(current, { type: "select", id }));
  };
  const navigation = useNavigationActions({
    onProjectPending: (pending) => {
      projectNavigationPending.current = pending;
    },
    api,
    tabs,
    database,
    databaseEpoch: snapshot?.databaseEpoch,
    projects: snapshot?.openProjects ?? [],
    chats: snapshot?.chats ?? [],
    runs: navigationRuns,
    selectedId: navigationSelectedId,
    onPage: selectPage,
    onSection: setSettingsSection,
    providers: snapshot?.agentSetup?.enabled ?? [],
    onProvider: (providerId) =>
      setTabs((current) => updateTabs(current, { type: "provider", providerId })),
    onProject: (projectId) =>
      setTabs((current) => updateTabs(current, { type: "project", projectId })),
    selectWorker,
    onArchived: () => notify("Chat archived."),
    onNavigate: (target) => history.expectTarget(target),
  });
  const history = useHistoryNavigation({
    snapshot,
    tabs,
    settingsSection,
    workerId,
    runs: navigationRuns,
    navigation,
    setError,
  });
  useEffect(() => {
    if (
      snapshot &&
      tabs.active === "project" &&
      !snapshot.openProjects?.some((project) => project.id === tabs.projectId)
    )
      setTabs((current) => updateTabs(current, { type: "select", id: "projects" }));
  }, [snapshot, tabs.active, tabs.projectId]);

  useEffect(() => {
    if (
      snapshot &&
      tabs.active === "provider" &&
      !snapshot.agentSetup?.enabled.includes(tabs.providerId ?? "")
    )
      setTabs((current) => updateTabs(current, { type: "select", id: "providers" }));
  }, [snapshot, tabs.active, tabs.providerId]);

  useLayoutEffect(() => {
    // Reveal nested sidebar ancestors before focus, without waiting for another frame.
    if (splash) return;
    const id =
      tabs.active === "settings" && settingsSection !== null
        ? `tab-settings-${settingsSection}`
        : tabs.active === "chat" && navigationSelectedId
          ? `conversation-${navigationSelectedId}`
          : sidebarPageElementId(tabs.active, tabs.projectId, tabs.providerId);
    return focusNavigation(id);
  }, [tabs.active, tabs.projectId, tabs.providerId, settingsSection, splash, navigationSelectedId]);

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
        setSettingsSection(null);
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
    setSettingsSection,
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
      {!splash && <div className="sidebar-background" aria-hidden="true" />}
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
          windowControls={
            appearance.customWindowControls ? <WindowControls onAction={controlWindow} /> : null
          }
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
      {!splash && appearance.customWindowControls && <WindowControls onAction={controlWindow} />}
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
            navigation={navigation}
            openProjects={snapshot?.openProjects}
            selectedProjectId={snapshot?.projectInstanceId}
            providerSetup={snapshot?.agentSetup}
            providerManagement={providerManagement}
            customAgents={snapshot?.customAgents ?? []}
            chats={snapshot?.chats ?? []}
            selectedId={navigationSelectedId}
            navigationSerial={chatRequest?.serial}
            runs={navigationRuns}
            database={database}
            eventsByRun={{ ...transcripts.events, ...state?.chatEventsByRun }}
            onOpenProject={() => showPicker("project")}
            onConnectDatabase={() => showPicker("database")}
            onSettingsSectionSelect={setSettingsSection}
            projectDisabled={
              busy || !snapshot || Boolean(snapshot.active && !snapshot.openProjects)
            }
            onSelect={selectPage}
            canGoBack={history.canGoBack}
            canGoForward={history.canGoForward}
            onBack={history.back}
            onForward={history.forward}
          />
        )}
        <AppPages
          providerManagement={providerManagement}
          updates={updates}
          api={api}
          state={state}
          project={project}
          preferences={preferences}
          sidebarBlurError={sidebarBlurError}
          appearance={appearance}
          tabs={tabs}
          settingsSection={settingsSection}
          navigation={navigation}
          navigationRuns={navigationRuns}
          setSettingsSection={setSettingsSection}
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
            const id = builtinRelayId(snapshot?.chats ?? []);
            if (!id) throw new Error("Relay is unavailable. Try again shortly.");
            if (!(await navigation.open({ kind: "conversation", id })))
              throw new Error("Unable to open Relay. Try again shortly.");
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
      {!splash &&
        snapshot &&
        (providerManagement.mode ||
          (snapshot.agentSetup?.complete && snapshot.agentSetup.session)) && (
          <AgentSetupWizard
            snapshot={snapshot}
            api={api}
            mode={providerManagement.mode ?? snapshot.agentSetup?.session?.mode ?? "add"}
            onClose={providerManagement.closeSetup}
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
