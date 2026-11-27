import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Action, AlertRecord, ApplicationClient, DesktopRun } from "../bridge/index.js";
import { AgentSetupWizard } from "./agent-setup.js";
import { useAlerts } from "./alerts.js";
import { useAppActions } from "./app-actions.js";
import { appCommands } from "./app-commands.js";
import { AppDialogs } from "./app-dialogs.js";
import { AppFooter } from "./app-footer.js";
import { AppMenus } from "./app-menus.js";
import { AppPages } from "./app-pages.js";
import type { useAppPreferences } from "./app-preferences.js";
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
import { RelayInputFocus } from "./relay-pulse.js";
import { useResumeDestination } from "./resume-destination.js";
import { useScopeLifetime } from "./scope-lifetime.js";
import { useScopedDetails } from "./scoped-details.js";
import { createSessionCommands } from "./session-commands.js";
import { hasOrchestrationProvider } from "./snapshot-state.js";
import { Splash } from "./splash.js";
import { useSplashEntry } from "./splash-entry.js";
import { initialTabs, type SettingsSectionId, updateTabs } from "./tabs.js";
import { selectedTerminalSource } from "./terminal-source.js";
import { useUpdateNotice, useUpdates } from "./updates.js";

export function App({
  api: transport,
  preferences,
  connected,
  backendControls,
}: {
  api: ApplicationClient;
  preferences: ReturnType<typeof useAppPreferences>;
  connected?: boolean;
  backendControls?: ReactNode;
}) {
  usePressFeedback();
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
  const updates = useUpdates(transport, snapshot?.versions.code60);
  const api = useMemo(
    () => bindDatabaseWrites(transport, snapshot?.databaseEpoch),
    [transport, snapshot?.databaseEpoch],
  );
  const providerManagement = useProviderManagement(api, snapshot);

  const [relayListening, setRelayListening] = useState(false);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(true);
  const [requestedWorkflow, setRequestedWorkflow] = useState<{ id: string; nonce: number } | null>(
    null,
  );
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
  const { theme, setTheme } = preferences;
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId | null>(null);
  const { splash, splashReady, setSetupOpen, enterApp, returnSplash } = useSplashEntry(snapshot);
  const alerts = useAlerts(transport, !splash && connected !== false);
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
  useResumeDestination(
    !splash && snapshot && orchestratorConfigured && connected !== false
      ? `code60.resume.${JSON.stringify(database)}`
      : undefined,
    history,
    builtinRelayId(snapshot?.chats ?? []),
    setError,
  );

  useLayoutEffect(() => {
    // Reveal nested sidebar ancestors before focus, without waiting for another frame.
    if (splash) return;
    const id =
      tabs.active === "settings" && settingsSection !== null
        ? `tab-settings-${settingsSection}`
        : sidebarPageElementId(tabs.active);
    return focusNavigation(
      tabs.active === "automations"
        ? "jobs-page-heading"
        : document.getElementById(id)
          ? id
          : `panel-${tabs.active}`,
    );
  }, [tabs.active, settingsSection, splash]);

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
    terminalSource: selectedTerminalSource(state, workerId),
  });

  const openRelay = async () => {
    setChatHistoryOpen(true);
    const id = builtinRelayId(snapshot?.chats ?? []);
    if (!id) throw new Error("Relay is unavailable. Try again shortly.");
    if (!(await navigation.open({ kind: "conversation", id })))
      throw new Error("Unable to open Relay. Try again shortly.");
  };
  const openWorkflow = (workflowId: string) => {
    setRequestedWorkflow({ id: workflowId, nonce: Date.now() });
    void navigation.open({ kind: "page", id: "workflows" });
  };
  const openAlert = (alert: AlertRecord) => {
    if (!alert.read) void alerts.markRead(alert.id);
    const target = alert.target;
    switch (target.kind) {
      case "relay":
        void openRelay().catch((cause: unknown) =>
          notify(cause instanceof Error ? cause.message : "Unable to open Relay.", "error"),
        );
        return;
      case "workflow":
        openWorkflow(target.id);
        return;
      case "settings":
        void navigation.open({ kind: "settings", id: target.id });
        return;
      case "custom-agent":
        void navigation.open({ kind: "custom-agent", id: target.id });
        return;
      case "conversation":
        setChatHistoryOpen(true);
        void navigation.open({ kind: "conversation", id: target.id }).then((opened) => {
          if (!opened) notify("That conversation is no longer open.", "error");
        });
        return;
      case "page":
        if (!pageAvailable(target.id, database)) {
          notify("Connect to a database first.", "error");
          return;
        }
        void navigation.open({ kind: "page", id: target.id });
        return;
    }
  };
  const footer = (close: () => void) => (
    <AppFooter
      api={api}
      state={state}
      transcripts={transcripts}
      tabs={tabs}
      workerId={workerId}
      busy={busy}
      showPicker={showPicker}
      navigation={navigation}
      navigationRuns={navigationRuns}
      updates={updates}
      openUpdates={openUpdates}
      closeWorkspace={close}
      onReturn={returnToSplash}
    />
  );
  const content = (
    <div className="app" data-product-screen={!splash || undefined}>
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
          onSetupChange={setSetupOpen}
          ready={splashReady && (snapshot !== undefined || error !== "")}
          snapshot={snapshot}
          api={api}
          busy={busy}
          error={error}
          theme={theme}
          onThemeChange={setTheme}
          onConnectDatabase={() => showPicker("database")}
          onOpenWebServer={() => {
            selectPage("web-server");
            enterApp();
          }}
          onEnter={() => {
            if (!orchestratorConfigured) return;
            enterApp();
          }}
        />
      )}
      {!splash && snapshot && !database && (
        <DatabaseNotice
          busy={busy}
          error={snapshot.databaseError}
          onConnect={() => showPicker("database")}
        />
      )}
      <div
        className="app-workspace"
        hidden={splash}
        inert={splash}
        data-chat={!splash && tabs.active === "chat"}
      >
        {!splash && (
          <PageTabBar
            relayListening={relayListening}
            showRelayDot={preferences.showRelayDot}
            onShowRelayDotChange={preferences.setShowRelayDot}
            autoApproval={snapshot?.orchestration.allowAll ?? true}
            onAutoApprovalChange={
              snapshot ? (value) => api.setOrchestrationAutoApproval(value) : undefined
            }
            alerts={{
              items: alerts.items,
              unreadCount: alerts.unreadCount,
              ...(alerts.error ? { error: alerts.error } : {}),
              onOpenAlert: openAlert,
              onMarkRead: (id) => void alerts.markRead(id),
              onMarkUnread: (id) => void alerts.markUnread(id),
              onMarkAllRead: () => void alerts.markAllRead(),
              onDismiss: (id) => void alerts.dismiss(id),
              onClearRead: () => void alerts.clearRead(),
            }}
            commands={() => setPalette(true)}
            workspace={(close) => (
              <>
                {footer(close)}
                {backendControls}
              </>
            )}
            connected={connected}
            theme={theme}
            onThemeChange={setTheme}
            tabs={tabs}
            settingsSection={settingsSection}
            navigation={navigation}
            chats={snapshot?.chats ?? []}
            database={database}
            onSettingsSectionSelect={setSettingsSection}
            onSelect={selectPage}
            onOpenChat={() => {
              setChatHistoryOpen(true);
              const id = builtinRelayId(snapshot?.chats ?? []);
              if (id) void navigation.open({ kind: "conversation", id });
              else selectPage("chat");
            }}
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
          openRelay={openRelay}
          requestedWorkflow={requestedWorkflow}
          onOpenWorkflow={openWorkflow}
          chatHistoryOpen={chatHistoryOpen}
          onChatHistoryOpenChange={setChatHistoryOpen}
          act={act}
          fileAction={fileAction}
          accept={accept}
        />
      </div>
      {splash && backendControls}
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
  return <RelayInputFocus.Provider value={setRelayListening}>{content}</RelayInputFocus.Provider>;
}
