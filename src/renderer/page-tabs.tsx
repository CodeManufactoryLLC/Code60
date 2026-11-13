import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  DesktopApi,
  DesktopRun,
  OpenProject,
  OrchestrationChat,
  OrchestrationChatAction,
  ProjectAction,
} from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
import { ChatSidebar } from "./chat-sidebar.js";
import { conversationId } from "./chats.js";
import { Icon } from "./icons.js";
import {
  groups,
  isSettingsSection,
  pageAvailable,
  pageDefinitions,
  pageGroup,
  pagesInGroup,
  settingsLabels,
} from "./navigation.js";
import { NavigationIcon } from "./navigation-icons.js";
import { ProjectChatSidebar } from "./project-chat-sidebar.js";
import { type PageId, type PageTabs, type SettingsSectionId, settingsSectionIds } from "./tabs.js";

export function PageTabBar({
  tabs,
  settingsSection,
  directory,
  onSelect,
  onSettingsSectionSelect,
  onOpenProject,
  onConnectDatabase,
  projectDisabled,
  api,
  chats,
  runs,
  onWorkerSelect,
  selectedId,
  navigationSerial,
  database,
  eventsByRun,
  openProjects,
  selectedProjectId,
}: {
  tabs: PageTabs;
  settingsSection: SettingsSectionId;
  /** The open project folder, if any. */
  directory?: string | undefined;
  onSelect(id: PageId): void;
  onSettingsSectionSelect(id: SettingsSectionId): void;
  onOpenProject(): void;
  onConnectDatabase?(): void;
  projectDisabled: boolean;
  api: DesktopApi;
  chats: readonly OrchestrationChat[];
  runs: readonly DesktopRun[];
  onWorkerSelect(id: string | undefined, projectId?: string | null): void;
  selectedId: string | undefined;
  navigationSerial: number | undefined;
  database: string | null;
  eventsByRun: Readonly<Record<string, readonly RunEvent[]>>;
  openProjects?: readonly OpenProject[] | undefined;
  selectedProjectId?: string | null | undefined;
}) {
  const sidebar = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem("code60.sidebarWidth"));
    return Number.isFinite(saved) && saved >= 180 && saved <= 480 ? saved : 220;
  });
  useLayoutEffect(() => {
    sidebar.current
      ?.closest<HTMLElement>(".app")
      ?.style.setProperty("--sidebar-width", `${width}px`);
    localStorage.setItem("code60.sidebarWidth", String(width));
  }, [width]);
  const resize = (value: number) => {
    const available = sidebar.current?.parentElement?.clientWidth ?? 840;
    setWidth(Math.max(180, Math.min(480, available - 360, value)));
  };
  return (
    <nav ref={sidebar} className="sidebar" aria-label="Sidebar">
      <button
        type="button"
        className="sidebar-resize"
        aria-label="Resize navigation sidebar"
        title="Resize navigation sidebar (Left/Right arrows)"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          resize(
            (sidebar.current?.getBoundingClientRect().width ?? width) +
              (event.key === "ArrowRight" ? 20 : -20),
          );
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId) && sidebar.current)
            resize(event.clientX - sidebar.current.getBoundingClientRect().left);
        }}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          if (sidebar.current) resize(event.clientX - sidebar.current.getBoundingClientRect().left);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      />
      <div id="navigation-sidebar-content" className="sidebar-content">
        <button
          type="button"
          className="sidebar-header project-card"
          data-empty={!database || !directory}
          disabled={projectDisabled}
          onClick={database ? onOpenProject : (onConnectDatabase ?? onOpenProject)}
          aria-haspopup="dialog"
          title={!database ? "Connect to database" : "Open Project"}
        >
          <span className="sidebar-title">
            {!database ? "Connect to database" : "Open Project"}
          </span>
        </button>
        <PageTabList
          tabs={tabs}
          settingsSection={settingsSection}
          onSelect={onSelect}
          onSettingsSectionSelect={onSettingsSectionSelect}
          api={api}
          chats={chats}
          runs={runs}
          onWorkerSelect={onWorkerSelect}
          selectedId={selectedId}
          navigationSerial={navigationSerial}
          database={database}
          eventsByRun={eventsByRun}
          openProjects={openProjects}
          selectedProjectId={selectedProjectId}
        />
      </div>
    </nav>
  );
}

const tablePages = pagesInGroup("tables");
const experimentPages = pagesInGroup("experiments");

function PageTabList({
  tabs,
  settingsSection,
  onSelect,
  onSettingsSectionSelect,
  api,
  chats,
  runs,
  onWorkerSelect,
  selectedId,
  navigationSerial,
  database,
  eventsByRun,
  openProjects,
  selectedProjectId,
}: {
  tabs: PageTabs;
  settingsSection: SettingsSectionId;
  onSelect(id: PageId): void;
  onSettingsSectionSelect(id: SettingsSectionId): void;
  api: DesktopApi;
  chats: readonly OrchestrationChat[];
  runs: readonly DesktopRun[];
  onWorkerSelect(id: string | undefined, projectId?: string | null): void;
  selectedId: string | undefined;
  navigationSerial: number | undefined;
  database: string | null;
  eventsByRun: Readonly<Record<string, readonly RunEvent[]>>;
  openProjects?: readonly OpenProject[] | undefined;
  selectedProjectId?: string | null | undefined;
}) {
  const [chatPending, setChatPending] = useState(false);
  const [chatError, setChatError] = useState("");
  const chatInFlight = useRef(false);
  async function projectAction(request: ProjectAction) {
    if (chatInFlight.current) return false;
    chatInFlight.current = true;
    setChatPending(true);
    setChatError("");
    try {
      await api.projectAction(request);
      return true;
    } catch (cause) {
      setChatError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      chatInFlight.current = false;
      setChatPending(false);
    }
  }
  async function chatAction(request: OrchestrationChatAction) {
    if (
      (!database &&
        !chats.some(
          (chat) =>
            chat.kind === "relay" &&
            (chat.run?.id === ("id" in request ? request.id : undefined) ||
              chat.conversationId === ("id" in request ? request.id : undefined)),
        )) ||
      chatInFlight.current
    )
      return false;
    chatInFlight.current = true;
    setChatPending(true);
    setChatError("");
    const navigate = request.type === "new" || request.type === "select";
    if (navigate) onSelect("chat");
    try {
      await api.orchestrationChatAction(request);
      if (navigate)
        onWorkerSelect(
          undefined,
          openProjects
            ? ((request.type === "new"
                ? request.projectId
                : chats.find(
                    (chat) => conversationId(chat) === ("id" in request ? request.id : undefined),
                  )?.projectId) ?? null)
            : undefined,
        );
      return true;
    } catch (cause) {
      setChatError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      chatInFlight.current = false;
      setChatPending(false);
    }
  }
  const [chatExpanded, setChatExpanded] = useState(
    () => localStorage.getItem("code60.chatExpanded") !== "false",
  );
  useEffect(() => {
    localStorage.setItem("code60.chatExpanded", String(chatExpanded));
  }, [chatExpanded]);
  useLayoutEffect(() => {
    if (chatExpanded && selectedId)
      document.querySelector("#chat-pages [aria-current='true']")?.scrollIntoView({
        block: "nearest",
      });
  }, [chatExpanded, selectedId]);
  const previousNavigation = useRef({ tabs, selectedId });
  useLayoutEffect(() => {
    const previous = previousNavigation.current;
    if (
      tabs.active === "chat" &&
      (previous.tabs !== tabs ||
        (previous.selectedId !== undefined && previous.selectedId !== selectedId))
    )
      setChatExpanded(true);
    previousNavigation.current = { tabs, selectedId };
  }, [tabs, selectedId]);
  const [settingsExpanded, setSettingsExpanded] = useState(
    () => localStorage.getItem("code60.settingsExpanded") === "true",
  );
  const [advancedExpanded, setAdvancedExpanded] = useState(
    () =>
      (localStorage.getItem("code60.advancedExpanded") ??
        localStorage.getItem("code60.experimentsExpanded")) === "true",
  );
  const [experimentsExpanded, setExperimentsExpanded] = useState(
    () => localStorage.getItem("code60.experimentsExpanded") === "true",
  );
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem("code60.tablesExpanded") === "true",
  );
  const navigationFrame = useRef<number | undefined>(undefined);
  const previousActivePage = useRef<PageId | undefined>(undefined);
  const experimentActive = experimentPages.includes(tabs.active);
  const advancedActive = experimentActive || tabs.active === "contributor-tools";
  const tableActive = tablePages.includes(tabs.active);
  useLayoutEffect(() => {
    const activeChanged = previousActivePage.current !== tabs.active;
    previousActivePage.current = tabs.active;
    if (tabs.active === "settings" || (activeChanged && pageGroup(tabs.active) === "advanced")) {
      setSettingsExpanded(true);
    }
    if (tablePages.includes(tabs.active)) setExpanded(true);
    else if (pageGroup(tabs.active) === "advanced") {
      setAdvancedExpanded(true);
      if (experimentPages.includes(tabs.active)) setExperimentsExpanded(true);
    } else return;
    // Expansion and modal focus restoration must finish before focusing the revealed page.
    navigationFrame.current = requestAnimationFrame(() => {
      navigationFrame.current = undefined;
      document.getElementById(`tab-${tabs.active}`)?.focus();
    });
    return () => {
      if (navigationFrame.current !== undefined) cancelAnimationFrame(navigationFrame.current);
    };
  }, [tabs]);
  useEffect(() => {
    localStorage.setItem("code60.tablesExpanded", String(expanded));
  }, [expanded]);
  useEffect(() => {
    localStorage.setItem("code60.settingsExpanded", String(settingsExpanded));
  }, [settingsExpanded]);
  useEffect(() => {
    localStorage.setItem("code60.advancedExpanded", String(advancedExpanded));
  }, [advancedExpanded]);
  useEffect(() => {
    localStorage.setItem("code60.experimentsExpanded", String(experimentsExpanded));
  }, [experimentsExpanded]);
  const openPages = (group: Parameters<typeof pagesInGroup>[0]) =>
    pagesInGroup(group).filter((id) => tabs.open.includes(id));
  const primary = openPages("primary");
  const experiments = openPages("experiments");
  const tables = openPages("tables");
  const destinations: (PageId | SettingsSectionId | "tables" | "advanced" | "experiments")[] = [
    "chat",
    ...primary,
    "tables",
    ...(expanded ? tables : []),
    "settings",
    ...(settingsExpanded
      ? ([
          ...settingsSectionIds,
          "advanced",
          ...(advancedExpanded
            ? [
                "experiments" as const,
                ...(experimentsExpanded ? experiments : []),
                "contributor-tools" as const,
              ]
            : []),
        ] as const)
      : []),
  ];
  const visible = destinations.filter(
    (id) =>
      database ||
      id === "tables" ||
      id === "advanced" ||
      isSettingsSection(id) ||
      (id !== "experiments" && pageAvailable(id, database)),
  );
  function moveTo(target: (typeof visible)[number] | undefined) {
    if (target === "tables" || target === "advanced" || target === "experiments") {
      document.getElementById(`${target}-toggle`)?.focus();
    } else if (target && isSettingsSection(target)) {
      onSelect("settings");
      onSettingsSectionSelect(target);
      document.getElementById(`tab-settings-${target}`)?.focus();
    } else if (target) {
      onSelect(target);
      document.getElementById(`tab-${target}`)?.focus();
    }
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, id: (typeof visible)[number]) {
    // A delayed reveal must not undo a subsequent keyboard navigation.
    if (navigationFrame.current !== undefined) {
      cancelAnimationFrame(navigationFrame.current);
      navigationFrame.current = undefined;
    }
    if (id === visible[1] && event.key === "ArrowUp" && chatExpanded) {
      const children = [
        ...document.querySelectorAll<HTMLButtonElement>("#chat-pages button:not(:disabled)"),
      ].filter((button) => !button.closest("[hidden]"));
      if (children.length) {
        event.preventDefault();
        children[children.length - 1]?.focus();
        return;
      }
    }
    if (id === "chat" && event.key === "ArrowDown" && chatExpanded) {
      const child = document.querySelector<HTMLButtonElement>("#chat-pages button:not(:disabled)");
      if (child) {
        event.preventDefault();
        child.focus();
        return;
      }
    }
    if (id === "chat" && event.key === "ArrowLeft") {
      event.preventDefault();
      setChatExpanded(false);
      return;
    }
    if (id === "chat" && event.key === "ArrowRight") {
      event.preventDefault();
      if (chatExpanded) document.querySelector<HTMLButtonElement>("#chat-pages button")?.focus();
      else setChatExpanded(true);
      return;
    }
    if (id === "settings" && event.key === "ArrowLeft") {
      event.preventDefault();
      setSettingsExpanded(false);
      return;
    }
    if (id === "settings" && event.key === "ArrowRight") {
      event.preventDefault();
      if (settingsExpanded) moveTo(settingsSectionIds[0]);
      else setSettingsExpanded(true);
      return;
    }
    if (isSettingsSection(id) && event.key === "ArrowLeft") {
      event.preventDefault();
      setSettingsExpanded(false);
      document.getElementById("tab-settings")?.focus();
      return;
    }
    if (
      event.key === "ArrowLeft" &&
      (id === "experiments" || experimentPages.some((pageId) => pageId === id))
    ) {
      event.preventDefault();
      if (id === "experiments" && !experimentsExpanded) moveTo("advanced");
      else {
        setExperimentsExpanded(false);
        moveTo("experiments");
      }
      return;
    }
    if (event.key === "ArrowRight" && id === "experiments") {
      event.preventDefault();
      if (experimentsExpanded && experiments[0]) moveTo(experiments[0]);
      else setExperimentsExpanded(true);
      return;
    }
    if (event.key === "ArrowLeft" && (id === "advanced" || id === "contributor-tools")) {
      event.preventDefault();
      if (id === "advanced" && !advancedExpanded) {
        document.getElementById("tab-settings")?.focus();
      } else {
        setAdvancedExpanded(false);
        moveTo("advanced");
      }
      return;
    }
    if (event.key === "ArrowRight" && id === "advanced") {
      event.preventDefault();
      if (advancedExpanded) moveTo(database ? "experiments" : "contributor-tools");
      else setAdvancedExpanded(true);
      return;
    }
    if (
      event.key === "ArrowLeft" &&
      (id === "tables" || tablePages.some((pageId) => pageId === id))
    ) {
      event.preventDefault();
      setExpanded(false);
      document.getElementById("tables-toggle")?.focus();
      return;
    }
    if (event.key === "ArrowRight" && id === "tables") {
      event.preventDefault();
      if (expanded && tables[0]) onSelect(tables[0]);
      else setExpanded(true);
      return;
    }
    const index = visible.indexOf(id);
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % visible.length
        : event.key === "ArrowUp"
          ? (index - 1 + visible.length) % visible.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? visible.length - 1
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    moveTo(visible[next]);
  }
  function page(id: PageId, first: boolean) {
    const icon = pageDefinitions[id].icon;
    return (
      <div
        className="page-tab"
        role="presentation"
        key={id}
        data-nav-active={id !== "settings" && tabs.active === id}
      >
        <button
          type="button"
          role="tab"
          id={`tab-${id}`}
          aria-controls={`panel-${id}`}
          aria-selected={tabs.active === id && (id !== "settings" || !settingsExpanded)}
          title={pageDefinitions[id].label}
          disabled={!pageAvailable(id, database)}
          tabIndex={
            tabs.active === id || (first && pageGroup(tabs.active) !== pageGroup(id)) ? 0 : -1
          }
          onClick={() => {
            if (id === "settings" && tabs.active === "settings") {
              setSettingsExpanded((value) => !value);
              return;
            }
            onSelect(id);
          }}
          onKeyDown={(event) => navigate(event, id)}
        >
          {icon && <NavigationIcon name={icon} />}
          <span className="page-tab-label">{pageDefinitions[id].label}</span>
        </button>
      </div>
    );
  }
  function settingsPage(id: SettingsSectionId) {
    const selected = tabs.active === "settings" && settingsSection === id;
    return (
      <div className="page-tab" role="presentation" key={id} data-nav-active={selected}>
        <button
          type="button"
          role="tab"
          id={`tab-settings-${id}`}
          aria-controls={`panel-settings-${id}`}
          aria-selected={selected}
          title={settingsLabels[id]}
          tabIndex={selected ? 0 : -1}
          onClick={() => {
            onSettingsSectionSelect(id);
            onSelect("settings");
          }}
          onKeyDown={(event) => navigate(event, id)}
        >
          <span className="page-tab-label">{settingsLabels[id]}</span>
        </button>
      </div>
    );
  }
  return (
    <div className="page-tabs">
      <div className="chat-page-heading" data-nav-active={tabs.active === "chat" && !selectedId}>
        <div className="page-tab" role="tablist" aria-label="Chat page" aria-orientation="vertical">
          <button
            type="button"
            role="tab"
            aria-selected={tabs.active === "chat"}
            title="Chat"
            id="tab-chat"
            className="page-group-toggle"
            aria-expanded={chatExpanded}
            aria-controls="panel-chat chat-pages"
            data-active={tabs.active === "chat" && !selectedId}
            onClick={() => {
              if (tabs.active !== "chat") onSelect("chat");
              else setChatExpanded((value) => !value);
            }}
            onKeyDown={(event) => navigate(event, "chat")}
          >
            {pageDefinitions.chat.icon && <NavigationIcon name={pageDefinitions.chat.icon} />}
            <span className="page-tab-label">{pageDefinitions.chat.label}</span>
            <Icon name={chatExpanded ? "chevron--down" : "chevron--right"} />
          </button>
        </div>
        {!chats.some((chat) => chat.kind === "relay") && (
          <button
            type="button"
            className="icon-button chat-sidebar-new"
            aria-label="New chat"
            title="New chat"
            disabled={chatPending || !database}
            onClick={() => {
              setChatExpanded(true);
              void chatAction({ type: "new" });
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                document.getElementById("tab-chat")?.focus();
              } else if (
                ["ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                navigate(event, "chat");
            }}
          >
            <Icon name="add" />
          </button>
        )}
      </div>
      {chatError && (
        <p className="error-banner" role="alert">
          {chatError}
        </p>
      )}
      {/* biome-ignore lint/a11y/useSemanticElements: navigation disclosure, not a form fieldset. */}
      <div
        id="chat-pages"
        role="group"
        aria-label="Chat conversations"
        className="page-group-pages"
        hidden={!chatExpanded}
        inert={!chatExpanded}
        aria-hidden={!chatExpanded}
        onKeyDown={(event) => {
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
          ].filter((button) => !button.closest("[hidden]"));
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          if (index < 0) return;
          if (event.key === "ArrowLeft" || (event.key === "ArrowUp" && index === 0)) {
            event.preventDefault();
            if (event.key === "ArrowLeft") setChatExpanded(false);
            document.getElementById("tab-chat")?.focus();
          } else if (
            event.key === "ArrowDown" ||
            event.key === "ArrowUp" ||
            event.key === "Home" ||
            event.key === "End"
          ) {
            event.preventDefault();
            if (event.key === "Home") {
              moveTo("chat");
              return;
            }
            if (event.key === "End") {
              moveTo(visible.at(-1));
              return;
            }
            const next = index + (event.key === "ArrowDown" ? 1 : -1);
            if (next >= buttons.length) moveTo(visible[1]);
            else buttons[next]?.focus();
          }
        }}
      >
        {openProjects ? (
          <ProjectChatSidebar
            projects={openProjects}
            selectedProjectId={selectedProjectId}
            onProjectAction={projectAction}
            onAction={chatAction}
            chats={chats}
            runs={runs}
            selectedId={selectedId}
            navigationSerial={navigationSerial}
            database={database}
            eventsByRun={eventsByRun}
            open={tabs.active === "chat"}
            pending={chatPending}
            onSelect={(id) => {
              if (chats.some((chat) => conversationId(chat) === id))
                void chatAction({ type: "select", id });
              else {
                onWorkerSelect(id);
                onSelect("chat");
              }
            }}
          />
        ) : (
          <ChatSidebar
            onAction={chatAction}
            chats={chats}
            runs={runs}
            selectedId={selectedId}
            navigationSerial={navigationSerial}
            database={database}
            eventsByRun={eventsByRun}
            open={tabs.active === "chat"}
            pending={chatPending}
            onSelect={(id) => {
              if (chats.some((chat) => conversationId(chat) === id))
                void chatAction({ type: "select", id });
              else {
                onWorkerSelect(id);
                onSelect("chat");
              }
            }}
          />
        )}
      </div>
      <div className="page-tab-list" role="tablist" aria-label="Pages" aria-orientation="vertical">
        {primary.map((id, index) => page(id, index === 0))}
      </div>
      <div className="page-tab" data-nav-active={tableActive && !expanded}>
        <button
          type="button"
          id="tables-toggle"
          title="Tables"
          className="page-group-toggle"
          aria-expanded={expanded}
          aria-controls="table-pages"
          data-active={tableActive && !expanded}
          onClick={() => {
            setExpanded((value) => !value);
          }}
          onKeyDown={(event) => navigate(event, "tables")}
        >
          <NavigationIcon name={groups.tables.icon} />
          <span className="page-tab-label">{groups.tables.label}</span>
          <Icon name={expanded ? "chevron--down" : "chevron--right"} />
        </button>
      </div>
      <div
        id="table-pages"
        className="page-tab-list page-group-pages"
        role="tablist"
        aria-label="Tables"
        aria-orientation="vertical"
        hidden={!expanded}
        inert={!expanded}
        aria-hidden={!expanded}
      >
        {tables.map((id, index) => page(id, index === 0))}
      </div>
      <div className="page-tab-list sidebar-settings">
        <div
          className="sidebar-settings-heading"
          data-active={(tabs.active === "settings" || advancedActive) && !settingsExpanded}
          data-nav-active={(tabs.active === "settings" || advancedActive) && !settingsExpanded}
        >
          <div
            className="page-tab-list"
            role="tablist"
            aria-label="Settings page"
            aria-orientation="vertical"
          >
            {page("settings", true)}
          </div>
          <button
            type="button"
            className="icon-button sidebar-settings-toggle"
            aria-label="Settings pages"
            aria-controls="settings-pages"
            aria-expanded={settingsExpanded}
            onClick={() => setSettingsExpanded((value) => !value)}
            onKeyDown={(event) => navigate(event, "settings")}
          >
            <Icon name={settingsExpanded ? "chevron--down" : "chevron--right"} />
          </button>
        </div>
        <div
          id="settings-pages"
          className="page-tab-list page-group-pages"
          hidden={!settingsExpanded}
          inert={!settingsExpanded}
          aria-hidden={!settingsExpanded}
        >
          <div
            className="page-tab-list"
            role="tablist"
            aria-label="Settings pages"
            aria-orientation="vertical"
          >
            {settingsSectionIds.map(settingsPage)}
          </div>
          <div className="page-tab" data-nav-active={advancedActive && !advancedExpanded}>
            <button
              type="button"
              id="advanced-toggle"
              className="page-group-toggle"
              aria-expanded={advancedExpanded}
              aria-controls="advanced-pages"
              data-active={advancedActive && !advancedExpanded}
              onClick={() => setAdvancedExpanded((value) => !value)}
              onKeyDown={(event) => navigate(event, "advanced")}
            >
              <span className="page-tab-label">{groups.advanced.label}</span>
              <Icon name={advancedExpanded ? "chevron--down" : "chevron--right"} />
            </button>
          </div>
          <div
            id="advanced-pages"
            className="page-tab-list page-group-pages"
            hidden={!advancedExpanded}
            inert={!advancedExpanded}
            aria-hidden={!advancedExpanded}
          >
            <div className="page-tab" data-nav-active={experimentActive && !experimentsExpanded}>
              <button
                type="button"
                id="experiments-toggle"
                disabled={!database}
                className="page-group-toggle"
                aria-expanded={experimentsExpanded}
                aria-controls="experiment-pages"
                data-active={experimentActive && !experimentsExpanded}
                onClick={() => setExperimentsExpanded((value) => !value)}
                onKeyDown={(event) => navigate(event, "experiments")}
              >
                <span className="page-tab-label">{groups.experiments.label}</span>
                <Icon name={experimentsExpanded ? "chevron--down" : "chevron--right"} />
              </button>
            </div>
            <div
              id="experiment-pages"
              role="tablist"
              aria-label="Experiments"
              aria-orientation="vertical"
              className="page-tab-list page-group-pages"
              hidden={!experimentsExpanded}
              inert={!experimentsExpanded}
              aria-hidden={!experimentsExpanded}
            >
              {experiments.map((id, index) => page(id, index === 0))}
            </div>
            <div role="tablist" aria-label="Contributor pages" aria-orientation="vertical">
              {page("contributor-tools", true)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
