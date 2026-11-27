import { Column, Grid } from "@carbon/react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { ProjectSearchOpened } from "../bridge/index.js";
import type { AppPagesProps } from "./app-page-props.js";
import { AppsPage } from "./apps-page.js";
import { AutomationsPage } from "./automations.js";
import { Button as AppButton } from "./carbon/button.js";
import { Surface as Card } from "./carbon/surfaces.js";
import { ChatWorkspace } from "./chat-workspace.js";
import { builtinRelayId, conversationId } from "./chats.js";
import { CommandsPage } from "./commands-page.js";
import { ConfigurationsTable } from "./configurations.js";
import { ContentHeaderSlot } from "./content-page-header.js";
import { CustomAgentsPage } from "./custom-agents.js";
import { EpisodicMemoryPage } from "./episodic-memory.js";
import { EventsPage } from "./events.js";
import { HealthCheckPage } from "./health-check.js";
import { HomePage } from "./home-page.js";
import { LogsPage } from "./logs.js";
import { McpWorkspace } from "./mcp-workspace.js";
import { MemoriesPage } from "./memories.js";
import { MemoryPage } from "./memory.js";
import { MessagesPage } from "./messages.js";
import {
  isSettingsSection,
  pageDefinitions,
  type RenderedPageId,
  renderedPages,
  settingsLabels,
} from "./navigation.js";
import { NavigationHomePage } from "./navigation-home-page.js";
import { staticChildren } from "./navigation-tree.js";
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
import { UsagePage } from "./usage-page.js";
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
  const [requestedWorkflow, setRequestedWorkflow] = useState<{ id: string; nonce: number } | null>(
    null,
  );
  usePageTransition(
    tabs.active,
    tabs.active === "settings"
      ? settingsSection
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
  const {
    theme,
    setTheme,
    textStyles,
    setTextStyles,
    lines,
    setLines,
    density,
    setDensity,
    fit,
    setFit,
    accentColor,
    setAccentColor,
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
    "mcp-servers": (
      <McpWorkspace
        api={api}
        active={!splash && tabs.active === "mcp-servers"}
        contextKey={JSON.stringify([
          snapshot?.databaseEpoch,
          snapshot?.openProjects?.map((p) => p.id),
        ])}
        lines={lines}
        density={density}
        fit={fit}
        textStyles={textStyles}
      />
    ),
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
        requestedWorkflow={requestedWorkflow}
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
    "health-check": (
      <HealthCheckPage
        api={api}
        active={!splash && tabs.active === "health-check"}
        {...(snapshot?.versions?.code60 ? { clientVersion: snapshot.versions.code60 } : {})}
        onNotify={notify}
        onNavigate={(link) => {
          if (link.kind === "relay") {
            props.openRelay();
          } else if (link.kind === "settings" && isSettingsSection(link.id)) {
            void navigation.open({ kind: "settings", id: link.id });
          } else if (link.kind === "page") {
            void navigation.open({ kind: "page", id: link.id as RenderedPageId });
          }
        }}
      />
    ),
    usage: <UsagePage api={api} active={!splash && tabs.active === "usage"} onNotify={notify} />,
    automations: (
      <AutomationsPage
        api={api}
        active={!splash && tabs.active === "automations"}
        agents={snapshot?.agents ?? []}
        onOpenWorkflow={(workflowId) => {
          setRequestedWorkflow({ id: workflowId, nonce: Date.now() });
          void navigation.open({ kind: "page", id: "workflows" });
        }}
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
          accentColor={accentColor}
          onAccentColor={setAccentColor}
          textStyles={textStyles}
          onTextStyles={setTextStyles}
          lines={lines}
          onLines={setLines}
          density={density}
          onDensity={setDensity}
          fit={fit}
          onFit={setFit}
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
            <AppButton
              type="button"
              className="primary"
              disabled={busy || !snapshot}
              onClick={() => showPicker("database")}
            >
              Connect to database
            </AppButton>
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
            <AppButton
              type="button"
              className="primary"
              disabled={busy || !snapshot}
              onClick={() => showPicker("database")}
            >
              Connect to database
            </AppButton>
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
          defaultPrompt={
            typeof snapshot?.prompts.find((entry) => entry.id === "memory.episodic-instructions")
              ?.template === "string"
              ? (snapshot.prompts.find((entry) => entry.id === "memory.episodic-instructions")
                  ?.template as string)
              : undefined
          }
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
          hasProjects={Boolean(snapshot?.projects.length)}
          onProjects={() => void navigation.open({ kind: "page", id: "projects" })}
          onOpen={setSearchTarget}
        />
      </>
    ),
    sessions: (
      <>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <AppButton type="button" aria-label="Dismiss error" onClick={() => setError("")}>
              Dismiss
            </AppButton>
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
            <AppButton
              type="button"
              className="primary"
              disabled={busy || !snapshot}
              onClick={() => showPicker("database")}
            >
              Connect to database
            </AppButton>
          </section>
        )}
      </>
    ),
  } satisfies Record<RenderedPageId, ReactNode>;
  return (
    <PageTitleNavigationContext.Provider value={titleNavigation}>
      <Grid
        fullWidth
        className="product-page-grid"
        data-chat-active={tabs.active === "chat" || undefined}
      >
        {renderedPages.map(({ id }) => {
          const Shell = id === "chat" ? "div" : Card;
          return (
            <Column
              as={Shell}
              sm={4}
              md={8}
              lg={16}
              key={id}
              className="page-panel"
              role="tabpanel"
              tabIndex={-1}
              id={`panel-${id}`}
              aria-label={
                id === "settings" && settingsSection
                  ? settingsLabels[settingsSection]
                  : pageDefinitions[id].label
              }
              aria-labelledby={
                id === "chat" && snapshot
                  ? `conversation-${props.workerId ?? conversationId(snapshot.chat)}`
                  : undefined
              }
              hidden={tabs.active !== id}
            >
              {id !== "chat" && id !== "automations" && (
                <ContentHeaderSlot
                  fallback={
                    id === "settings" && settingsSection
                      ? settingsLabels[settingsSection]
                      : pageDefinitions[id].label
                  }
                />
              )}
              {views[id]}
            </Column>
          );
        })}
      </Grid>
    </PageTitleNavigationContext.Provider>
  );
}
