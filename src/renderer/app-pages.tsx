import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { ProjectSearchOpened } from "../bridge/index.js";
import type { AppPagesProps } from "./app-page-props.js";
import { AppsPage } from "./apps-page.js";
import { AutomationsPage } from "./automations.js";
import { ChatWorkspace } from "./chat-workspace.js";
import { builtinRelayId, conversationId } from "./chats.js";
import { CommandsPage } from "./commands-page.js";
import { ConfigurationsTable } from "./configurations.js";
import { ContentHeaderSlot } from "./content-page-header.js";
import { CustomAgentsPage } from "./custom-agents.js";
import { EpisodicMemoryPage } from "./episodic-memory.js";
import { EventsPage } from "./events.js";
import { HomePage } from "./home-page.js";
import { LogsPage } from "./logs.js";
import { MemoriesPage } from "./memories.js";
import { MemoryPage } from "./memory.js";
import { MessagesPage } from "./messages.js";
import {
  isSettingsSection,
  pageDefinitions,
  type RenderedPageId,
  renderedPages,
  settingsIcons,
  settingsLabels,
} from "./navigation.js";
import { NavigationHomePage } from "./navigation-home-page.js";
import { sidebarPageElementId, staticChildren } from "./navigation-tree.js";
import { Card } from "./neobrutalism/card.js";
import { PageTitle, PageTitleNavigationContext } from "./page-title.js";
import { usePageTransition } from "./page-transition.js";
import { PollingControls, PollingPage } from "./polling.js";
import { ProjectHomePages, ProjectsHomePage } from "./project-home-pages.js";
import { PromptEditorPage } from "./prompt-editor.js";
import { ProvidersPage } from "./providers-page.js";
import { RagPage } from "./rag.js";
import { SearchPage } from "./search-page.js";
import { sessionRows } from "./session-presentation.js";
import { SessionsTable } from "./sessions.js";
import { SettingsHomePage } from "./settings-home-page.js";
import { SettingsPage } from "./settings-page.js";
import { SystemManagerPage } from "./system-manager.js";
import { updateTabs } from "./tabs.js";
import { UpdatesSection } from "./updates.js";
import { WebServerPage } from "./web-server.js";
import { WorkflowsPage } from "./workflows.js";
import { WorktreesPage } from "./worktrees.js";

export function AppPages(props: AppPagesProps) {
  const { updates } = props;
  const { setExplorerOpen } = props.project;
  const {
    api,
    state,
    project,
    preferences,
    appearance,
    tabs,
    settingsSection,
    navigation,
    navigationRuns,
    splash,
    busy,
    error,
    fileBrowser,
    transcripts,
    orchestratorConfigured,
    setTabs,
    setError,
    showPicker,
    attempt,
    notify,
    openChat,
    act,
    fileAction,
    accept,
  } = props;
  const snapshot = state?.snapshot;
  usePageTransition(
    tabs.active,
    tabs.active === "settings"
      ? settingsSection
      : tabs.active === "provider"
        ? tabs.providerId
        : tabs.active === "project"
          ? tabs.projectId
          : tabs.active === "chat"
            ? (props.workerId ?? (snapshot && conversationId(snapshot.chat)))
            : undefined,
    !splash,
  );
  const titleNavigation = useMemo(
    () => ({
      selectionPending: navigation.projectPending || navigation.conversationPending,
      header: !splash,
    }),
    [navigation.projectPending, navigation.conversationPending, splash],
  );
  const projectRuns = useMemo(
    () => snapshot?.runs.filter((run) => !run.relay) ?? [],
    [snapshot?.runs],
  );
  const {
    scope,
    selected,
    setSelected,
    selectedConfiguration,
    setSelectedConfiguration,
    setConfigurationEditor,
    setConfigurationMenu,
    setPollMenu,
    setWorktreeMenu,
    setSetup,
    setMenu,
  } = project;
  const database = scope.database;
  const directory = scope.project;
  const workspace = scope.workspace;
  const databaseKey = JSON.stringify([database, state?.databaseGeneration ?? 0]);
  const { sidebarBlurSupported } = appearance;
  const {
    theme,
    setTheme,
    iconAppearance,
    setIconAppearance,
    iconAppearanceSaved,
    sidebarAppearance,
    setSidebarAppearance,
    sidebarAppearanceSaved,
    textStyles,
    setTextStyles,
    lines,
    setLines,
    density,
    setDensity,
    fit,
    setFit,
    focusHighlight,
    setFocusHighlight,
    signals,
    setSignals,
    charts,
    setCharts,
    chartTickMs,
    setChartTickMs,
  } = preferences;
  const run = snapshot?.runs.find((item) => item.record.id === selected);
  const rows = useMemo(() => sessionRows(snapshot?.runs ?? []), [snapshot?.runs]);
  const parentHome = (page: "tables" | "advanced" | "experiments") => (
    <NavigationHomePage
      page={page}
      cards={staticChildren(page, database)}
      onOpen={({ target }) => void navigation.open(target)}
    />
  );
  const [searchTarget, setSearchTarget] = useState<ProjectSearchOpened | null>(null);
  useEffect(() => {
    if (!searchTarget) return;
    if (snapshot?.databaseEpoch !== searchTarget.databaseEpoch) {
      setSearchTarget(null);
      return;
    }
    if (
      snapshot.projectInstanceId !== searchTarget.projectId ||
      directory !== searchTarget.source.project.path ||
      snapshot.revision < searchTarget.revision
    )
      return;
    setSearchTarget(null);
    const source = searchTarget.source;
    if (source.kind === "file" && source.path) {
      fileAction({ type: "file", path: source.path });
      fileBrowser.selectFile(source.path);
      setExplorerOpen(true);
      setTabs((current) => updateTabs(current, { type: "select", id: "chat" }));
    } else if (source.kind === "project")
      void navigation.open({ kind: "project", id: searchTarget.projectId });
    else if (source.runId) {
      setSelected(source.runId);
      openChat(source.runId, false, source.eventIndex);
    }
  }, [
    searchTarget,
    snapshot?.databaseEpoch,
    snapshot?.projectInstanceId,
    snapshot?.revision,
    directory,
    fileAction,
    fileBrowser,
    setExplorerOpen,
    setTabs,
    navigation,
    setSelected,
    openChat,
  ]);
  const views = {
    assistants: (
      <HomePage
        page="assistants"
        database={database}
        relayAvailable={Boolean(builtinRelayId(snapshot?.chats ?? []))}
        onOpenRelay={props.openRelay}
        onOpenPage={(id) => void navigation.open({ kind: "page", id })}
      />
    ),
    "custom-agents": (
      <CustomAgentsPage
        storageError={snapshot?.customAgentError}
        api={api}
        agents={snapshot?.customAgents ?? []}
        active={!splash && tabs.active === "custom-agents"}
        onOpen={(id) => navigation.open({ kind: "custom-agent", id })}
      />
    ),
    providers: (
      <ProvidersPage
        api={api}
        snapshot={snapshot}
        management={props.providerManagement}
        active={!splash && tabs.active === "providers"}
        onOpen={(id) => void navigation.open({ kind: "provider", id })}
      />
    ),
    provider: (
      <ProvidersPage
        api={api}
        snapshot={snapshot}
        management={props.providerManagement}
        providerId={tabs.providerId}
        active={!splash && tabs.active === "provider"}
        onOpen={(id) => void navigation.open({ kind: "provider", id })}
      />
    ),
    projects: (
      <ProjectsHomePage
        projects={snapshot?.openProjects ?? []}
        navigation={navigation}
        database={database}
        onOpenProject={() => showPicker(database ? "project" : "database")}
      />
    ),
    project: (
      <ProjectHomePages
        projects={snapshot?.openProjects ?? []}
        chats={snapshot?.chats ?? []}
        runs={navigationRuns}
        selectedId={props.workerId ?? (snapshot && conversationId(snapshot.chat))}
        activeId={tabs.projectId}
        navigation={navigation}
      />
    ),
    tables: parentHome("tables"),
    advanced: parentHome("advanced"),
    experiments: parentHome("experiments"),
    workflows: (
      <WorkflowsPage
        api={api}
        active={!splash && tabs.active === "workflows"}
        paused={snapshot?.polling.paused ?? false}
        providerReady={snapshot?.agentSetup?.complete ?? false}
        onProvider={() => void navigation.open({ kind: "page", id: "providers" })}
      />
    ),
    "system-manager": (
      <SystemManagerPage
        api={api}
        active={!splash && tabs.active === "system-manager"}
        pollingPaused={snapshot?.polling.paused ?? false}
      />
    ),
    automations: (
      <AutomationsPage
        api={api}
        active={!splash && tabs.active === "automations"}
        agents={snapshot?.agents ?? []}
        lines={lines}
        density={density}
        fit={fit}
        textStyles={textStyles}
      />
    ),
    memories: (
      <MemoriesPage
        api={api}
        active={!splash && tabs.active === "memories"}
        lines={lines}
        density={density}
        fit={fit}
        textStyles={textStyles}
      />
    ),
    apps: (
      <AppsPage
        database={database}
        onOpen={(id) =>
          void navigation.open(
            isSettingsSection(id) ? { kind: "settings", id } : { kind: "page", id },
          )
        }
      />
    ),
    home: (
      <HomePage
        database={database}
        relayAvailable={Boolean(builtinRelayId(snapshot?.chats ?? []))}
        onOpenRelay={props.openRelay}
        onOpenPage={(id) => void navigation.open({ kind: "page", id })}
      />
    ),
    chat: <ChatWorkspace {...props} />,
    rag: (
      <RagPage
        key={databaseKey}
        api={api}
        database={database}
        databaseEpoch={snapshot?.databaseEpoch}
      />
    ),
    settings: (
      <>
        {settingsSection === null && (
          <SettingsHomePage
            database={database}
            onOpen={(id) => {
              void navigation.open(
                isSettingsSection(id) ? { kind: "settings", id } : { kind: "page", id },
              );
            }}
          />
        )}
        <SettingsPage
          section={settingsSection}
          memory={
            <MemoryPage
              api={api}
              active={!splash && tabs.active === "settings" && settingsSection === "memory"}
              onManage={() =>
                setTabs((current) => updateTabs(current, { type: "select", id: "memories" }))
              }
            />
          }
          updates={<UpdatesSection updates={updates} />}
          versions={snapshot?.versions}
          pollingControls={
            snapshot && (
              <fieldset disabled={!database} className="database-dependent-controls">
                <legend className="sr-only">Project polling</legend>
                <PollingControls
                  polling={snapshot.polling}
                  api={api}
                  chartTickMs={chartTickMs}
                  onChartTick={setChartTickMs}
                  onOpenMonitor={() =>
                    setTabs((current) => updateTabs(current, { type: "select", id: "polling" }))
                  }
                />
              </fieldset>
            )
          }
          theme={theme}
          onTheme={setTheme}
          iconAppearance={iconAppearance}
          iconAppearanceSaved={iconAppearanceSaved}
          onIconAppearance={setIconAppearance}
          sidebarAppearance={sidebarAppearance}
          sidebarAppearanceSaved={sidebarAppearanceSaved}
          sidebarBlurSupported={sidebarBlurSupported}
          sidebarBlurError={props.sidebarBlurError}
          onSidebarAppearance={setSidebarAppearance}
          textStyles={textStyles}
          onTextStyles={setTextStyles}
          lines={lines}
          onLines={setLines}
          density={density}
          onDensity={setDensity}
          fit={fit}
          onFit={setFit}
          focusHighlight={focusHighlight}
          onFocusHighlight={setFocusHighlight}
          signals={signals}
          onSignals={setSignals}
          charts={charts}
          onCharts={setCharts}
        />
      </>
    ),
    configurations: (
      <>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {database && snapshot ? (
          <main className="sessions" aria-label="Configurations" data-heading-lines={lines.heading}>
            <ConfigurationsTable
              key={scope.viewKey}
              tableId="configurations"
              workspace={`${database}:${directory}`}
              onAdd={() => {
                setError("");
                setConfigurationEditor("new");
              }}
              addDisabled={busy}
              configurations={snapshot.configurations}
              selected={selectedConfiguration}
              onSelect={setSelectedConfiguration}
              onActions={(id, bounds) => {
                setSelectedConfiguration(id);
                setConfigurationMenu({ id, bounds });
              }}
              lines={lines}
              density={density}
              fit={fit}
              textStyles={textStyles}
            />
          </main>
        ) : (
          <section className="welcome">
            <p>Connect to a database to manage run configurations.</p>
            <button
              type="button"
              className="primary"
              disabled={busy || !snapshot}
              onClick={() => showPicker("database")}
            >
              Connect to database
            </button>
          </section>
        )}
      </>
    ),
    prompts: (
      <>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {database && snapshot ? (
          <PromptEditorPage
            key={databaseKey}
            prompts={snapshot.prompts}
            busy={busy}
            onSave={async (id, template) => {
              const saved = await attempt(() => api.savePromptTemplate({ id, template }));
              if (saved) notify("Prompt template saved.");
              return saved;
            }}
            onReset={async (id) => {
              let reset = false;
              const ok = await attempt(async () => {
                reset = await api.resetPromptTemplate(id);
              });
              if (ok && reset) notify("Prompt template reset.");
              return ok && reset;
            }}
          />
        ) : (
          <section className="welcome">
            <p>Connect to a database to edit prompt templates.</p>
            <button
              type="button"
              className="primary"
              disabled={busy || !snapshot}
              onClick={() => showPicker("database")}
            >
              Connect to database
            </button>
          </section>
        )}
      </>
    ),
    commands: (
      <>
        {database && snapshot && (
          <CommandsPage
            key={databaseKey}
            commands={snapshot.commands}
            api={api}
            onSnapshot={(next) => accept(next)}
          />
        )}
      </>
    ),
    logs: (
      <>
        <LogsPage
          api={api}
          active={tabs.active === "logs"}
          project={directory ?? null}
          lines={lines}
          density={density}
          fit={fit}
          textStyles={textStyles}
        />
      </>
    ),
    polling: (
      <>
        {snapshot && (
          <PollingPage
            key={scope.viewKey}
            workspace={database ?? "none"}
            polling={snapshot.polling}
            chartTickMs={chartTickMs}
            visible={tabs.active === "polling"}
            lines={lines}
            density={density}
            fit={fit}
            textStyles={textStyles}
            onActions={(id, bounds) => {
              setPollMenu({ id, bounds });
            }}
          />
        )}
      </>
    ),
    worktrees: (
      <>
        {
          <WorktreesPage
            key={scope.viewKey}
            workspace={workspace}
            onActions={(id, bounds) => setWorktreeMenu({ id, bounds, workspace })}
            listing={snapshot?.worktrees ?? null}
            pollState={snapshot?.polling.sources.find((source) => source.key === "worktrees")}
            directory={directory ?? null}
            lines={lines}
            density={density}
            fit={fit}
            textStyles={textStyles}
          />
        }
      </>
    ),
    messages: (
      <>
        <MessagesPage
          key={scope.viewKey}
          data={transcripts}
          workspace={workspace}
          runs={snapshot?.runs ?? []}
          directory={directory ?? null}
          lines={lines}
          density={density}
          fit={fit}
          textStyles={textStyles}
        />
      </>
    ),
    "web-server": <WebServerPage api={api} visible={tabs.active === "web-server"} />,
    "contributor-tools": (
      <>
        <main className="contributor-tools">
          <PageTitle page="contributor-tools" />
          <p>No contributor tools yet.</p>
        </main>
      </>
    ),
    "episodic-memory": (
      <>
        <EpisodicMemoryPage
          key={scope.viewKey}
          api={api}
          directory={directory ?? null}
          runs={projectRuns}
          data={transcripts}
          provider={orchestratorConfigured ? (snapshot?.orchestration.provider ?? null) : null}
        />
      </>
    ),
    events: (
      <>
        <EventsPage
          key={scope.viewKey}
          data={transcripts}
          workspace={workspace}
          runs={snapshot?.runs ?? []}
          directory={directory ?? null}
          lines={lines}
          density={density}
          fit={fit}
          textStyles={textStyles}
          onOpen={(id, eventIndex) => {
            setSelected(id);
            openChat(id, false, eventIndex);
          }}
        />
      </>
    ),
    search: (
      <>
        <SearchPage
          key={databaseKey}
          api={api}
          provider={snapshot?.orchestration.provider ?? null}
          database={database}
          databaseEpoch={snapshot?.databaseEpoch ?? 0}
          onOpen={setSearchTarget}
        />
      </>
    ),
    sessions: (
      <>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button type="button" aria-label="Dismiss error" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
        {snapshot?.databaseError && (
          <div className="warning-banner" role="status">
            {snapshot.databaseError}
          </div>
        )}
        {snapshot?.warnings.map((warning) => (
          <div className="warning-banner" key={warning}>
            {warning}
          </div>
        ))}
        {database ? (
          <main className="sessions" aria-label="Sessions" data-heading-lines={lines.heading}>
            <SessionsTable
              key={scope.viewKey}
              pageActions={[
                ...(run?.agentAlive
                  ? [
                      {
                        id: "app-pages-0",
                        label: "Stop leftover agent",
                        run: () => void act({ type: "stop", id: run.record.id }),
                        disabled: busy,
                      },
                    ]
                  : []),
                ...(snapshot?.active
                  ? [
                      {
                        id: "app-pages-1",
                        label: "Stop all runs",
                        run: () => void attempt(() => api.stopAll()),
                        disabled: busy,
                      },
                    ]
                  : []),
              ]}
              tableId="sessions"
              workspace={`${database}:${directory}`}
              onAdd={() => {
                setError("");
                setSetup(true);
              }}
              addDisabled={!directory || busy}
              rows={rows}
              events={state?.events ?? {}}
              charts={charts}
              chartTickMs={chartTickMs}
              visible={tabs.active === "sessions"}
              selected={selected}
              onSelect={(id) => {
                setSelected(id);
                openChat(id);
                setError("");
              }}
              onActions={(id, bounds, contextual) => {
                setSelected(id);
                setMenu({ id, bounds, contextual });
              }}
              lines={lines}
              density={density}
              fit={fit}
              textStyles={textStyles}
            />
          </main>
        ) : (
          <section className="welcome">
            <button
              type="button"
              className="primary"
              disabled={busy || !snapshot}
              onClick={() => showPicker("database")}
            >
              Connect to database
            </button>
          </section>
        )}
      </>
    ),
  } satisfies Record<RenderedPageId, ReactNode>;
  return (
    <PageTitleNavigationContext.Provider value={titleNavigation}>
      {renderedPages.map(({ id }) => {
        const Shell = id === "chat" ? "div" : Card;
        return (
          <Shell
            key={id}
            className="page-panel"
            role="tabpanel"
            id={`panel-${id}`}
            aria-labelledby={
              id === "settings" && settingsSection
                ? `tab-settings-${settingsSection}`
                : id === "chat" && snapshot
                  ? `conversation-${props.workerId ?? conversationId(snapshot.chat)}`
                  : sidebarPageElementId(id, tabs.projectId, tabs.providerId)
            }
            hidden={tabs.active !== id}
          >
            {id !== "chat" && (
              <ContentHeaderSlot
                icon={
                  id === "settings" && settingsSection
                    ? settingsIcons[settingsSection]
                    : pageDefinitions[id].icon
                }
                fallback={
                  id === "settings" && settingsSection
                    ? settingsLabels[settingsSection]
                    : pageDefinitions[id].label
                }
              />
            )}
            {views[id]}
          </Shell>
        );
      })}
    </PageTitleNavigationContext.Provider>
  );
}
