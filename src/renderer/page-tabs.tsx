import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DesktopRun, OpenProject, OrchestrationChat } from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
import { ChatSidebar } from "./chat-sidebar.js";
import { conversationId } from "./chats.js";
import { Icon } from "./icons.js";
import {
  isSettingsSection,
  pageAvailable,
  pageDefinitions,
  pageGroup,
  settingsIcons,
  settingsLabels,
} from "./navigation.js";
import type { NavigationActions } from "./navigation-actions.js";
import { NavigationIcon } from "./navigation-icons.js";
import {
  inNavigationBranch,
  navigationParent,
  parentActivation,
  sidebarPageElementId,
  staticChildren,
} from "./navigation-tree.js";
import { ProjectChatSidebar } from "./project-chat-sidebar.js";
import { observeWorkspaceInset } from "./sidebar-layout.js";
import type { PageId, PageTabs, SettingsSectionId } from "./tabs.js";

export function PageTabBar({
  tabs,
  settingsSection,
  onSelect,
  onSettingsSectionSelect,
  onOpenProject,
  onConnectDatabase,
  projectDisabled,
  navigation,
  chats,
  runs,
  selectedId,
  navigationSerial,
  database,
  eventsByRun,
  openProjects,
  selectedProjectId,
}: {
  tabs: PageTabs;
  settingsSection: SettingsSectionId | null;
  onSelect(id: PageId): void;
  onSettingsSectionSelect(id: SettingsSectionId | null): void;
  onOpenProject(): void;
  onConnectDatabase?(): void;
  projectDisabled: boolean;
  navigation: NavigationActions;
  chats: readonly OrchestrationChat[];
  runs: readonly DesktopRun[];
  selectedId: string | undefined;
  navigationSerial: number | undefined;
  database: string | null;
  eventsByRun: Readonly<Record<string, readonly RunEvent[]>>;
  openProjects?: readonly OpenProject[] | undefined;
  selectedProjectId?: string | null | undefined;
}) {
  const sidebar = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(() => localStorage.getItem("code60.sidebarOpen") !== "false");
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
  useEffect(() => {
    localStorage.setItem("code60.sidebarOpen", String(open));
  }, [open]);
  useLayoutEffect(() => {
    const workspace = sidebar.current?.closest<HTMLElement>(".app-workspace");
    if (!workspace) return;
    const notice = database ? null : workspace.parentElement?.querySelector(".database-notice");
    return observeWorkspaceInset(workspace, notice ?? null);
  }, [database]);
  const resize = (value: number) => {
    const available = sidebar.current?.parentElement?.clientWidth ?? 840;
    setWidth(Math.max(180, Math.min(480, available - 360, value)));
  };
  return (
    <>
      <nav
        ref={sidebar}
        id="navigation-sidebar"
        className="sidebar"
        aria-label="Sidebar"
        data-open={open}
        inert={!open}
        aria-hidden={!open}
      >
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
            if (sidebar.current)
              resize(event.clientX - sidebar.current.getBoundingClientRect().left);
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        />
        <div id="navigation-sidebar-content" className="sidebar-content">
          <PageTabList
            onOpenProject={database ? onOpenProject : (onConnectDatabase ?? onOpenProject)}
            projectDisabled={projectDisabled}
            tabs={tabs}
            settingsSection={settingsSection}
            onSelect={onSelect}
            onSettingsSectionSelect={onSettingsSectionSelect}
            navigation={navigation}
            chats={chats}
            runs={runs}
            selectedId={selectedId}
            navigationSerial={navigationSerial}
            database={database}
            eventsByRun={eventsByRun}
            openProjects={openProjects}
            selectedProjectId={selectedProjectId}
          />
        </div>
      </nav>
      <header className="workspace-header">
        <button
          ref={toggle}
          type="button"
          className="icon-button sidebar-toggle"
          aria-label={open ? "Close navigation sidebar" : "Open navigation sidebar"}
          title={open ? "Close navigation sidebar" : "Open navigation sidebar"}
          aria-controls="navigation-sidebar"
          aria-expanded={open}
          onClick={() => {
            if (sidebar.current?.contains(document.activeElement)) toggle.current?.focus();
            setOpen((current) => !current);
          }}
        >
          <Icon name={open ? "side-panel--close" : "side-panel--open"} />
        </button>
      </header>
    </>
  );
}

function PageTabList({
  onOpenProject,
  projectDisabled,
  tabs,
  settingsSection,
  onSelect,
  onSettingsSectionSelect,
  navigation,
  chats,
  runs,
  selectedId,
  navigationSerial,
  database,
  eventsByRun,
  openProjects,
  selectedProjectId,
}: {
  onOpenProject(): void;
  projectDisabled: boolean;
  tabs: PageTabs;
  settingsSection: SettingsSectionId | null;
  onSelect(id: PageId): void;
  onSettingsSectionSelect(id: SettingsSectionId | null): void;
  navigation: NavigationActions;
  chats: readonly OrchestrationChat[];
  runs: readonly DesktopRun[];
  selectedId: string | undefined;
  navigationSerial: number | undefined;
  database: string | null;
  eventsByRun: Readonly<Record<string, readonly RunEvent[]>>;
  openProjects?: readonly OpenProject[] | undefined;
  selectedProjectId?: string | null | undefined;
}) {
  const { pending: chatPending, error: chatError, chatAction, projectAction } = navigation;
  const relay = chats.find((chat) => chat.kind === "relay");
  const relayId = relay && conversationId(relay);
  const relaySelected = relayId !== undefined && relayId === selectedId;
  const [chatExpanded, setChatExpanded] = useState(
    () => localStorage.getItem("code60.chatExpanded") !== "false",
  );
  useEffect(() => {
    localStorage.setItem("code60.chatExpanded", String(chatExpanded));
  }, [chatExpanded]);
  useLayoutEffect(() => {
    if (chatExpanded && selectedId && !relaySelected)
      document.querySelector("#chat-pages [aria-current='true']")?.scrollIntoView({
        block: "nearest",
      });
  }, [chatExpanded, selectedId, relaySelected]);
  const previousNavigation = useRef({ tabs, selectedId });
  useLayoutEffect(() => {
    const previous = previousNavigation.current;
    if (
      (tabs.active === "project" || (tabs.active === "chat" && !relaySelected)) &&
      (previous.tabs !== tabs ||
        (previous.selectedId !== undefined && previous.selectedId !== selectedId))
    )
      setChatExpanded(true);
    previousNavigation.current = { tabs, selectedId };
  }, [tabs, selectedId, relaySelected]);
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
  const [appsExpanded, setAppsExpanded] = useState(
    () => localStorage.getItem("code60.toolsExpanded") !== "false",
  );
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem("code60.tablesExpanded") === "true",
  );
  const navigationFrame = useRef<number | undefined>(undefined);
  const previousActivePage = useRef<PageId | undefined>(undefined);
  const experimentActive = inNavigationBranch(tabs.active, "experiments");
  const advancedActive = inNavigationBranch(tabs.active, "advanced");
  const tableActive = inNavigationBranch(tabs.active, "tables");
  const appActive = inNavigationBranch(tabs.active, "apps");
  useLayoutEffect(() => {
    const activeChanged = previousActivePage.current !== tabs.active;
    previousActivePage.current = tabs.active;
    if (tabs.active === "settings" || (activeChanged && advancedActive)) setSettingsExpanded(true);
    if (appActive) setAppsExpanded(true);
    if (tableActive) setExpanded(true);
    if (advancedActive) setAdvancedExpanded(true);
    if (experimentActive) setExperimentsExpanded(true);
    if (!appActive && !advancedActive && tabs.active !== "settings") return;
    navigationFrame.current = requestAnimationFrame(() => {
      navigationFrame.current = undefined;
      if (document.getElementById(`panel-${tabs.active}`)?.contains(document.activeElement)) return;
      const id =
        tabs.active === "settings" && settingsSection !== null
          ? `tab-settings-${settingsSection}`
          : sidebarPageElementId(tabs.active, tabs.projectId);
      document.getElementById(id)?.focus();
    });
    return () => {
      if (navigationFrame.current !== undefined) cancelAnimationFrame(navigationFrame.current);
    };
  }, [tabs, settingsSection, appActive, tableActive, advancedActive, experimentActive]);
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
  useEffect(() => {
    localStorage.setItem("code60.toolsExpanded", String(appsExpanded));
  }, [appsExpanded]);
  const disclosures = {
    apps: { open: appsExpanded, set: setAppsExpanded, panel: "app-pages" },
    settings: { open: settingsExpanded, set: setSettingsExpanded, panel: "settings-pages" },
    tables: { open: expanded, set: setExpanded, panel: "table-pages" },
    advanced: { open: advancedExpanded, set: setAdvancedExpanded, panel: "advanced-pages" },
    experiments: {
      open: experimentsExpanded,
      set: setExperimentsExpanded,
      panel: "experiment-pages",
    },
  };
  type StaticParent = keyof typeof disclosures;
  const isParent = (id: string): id is StaticParent => Object.hasOwn(disclosures, id);
  const childIds = (parent: StaticParent) =>
    staticChildren(parent, database).flatMap(({ target }) =>
      target.kind === "page" || target.kind === "settings" ? [target.id] : [],
    );
  const descendants = (parent: StaticParent): (PageId | SettingsSectionId)[] =>
    childIds(parent).flatMap((id) => [
      id,
      ...(isParent(id) && disclosures[id].open ? descendants(id) : []),
    ]);
  const destinations: (PageId | SettingsSectionId | "relay")[] = [
    "home",
    ...(relay && !chatPending ? ["relay" as const] : []),
    "search",
    "chat",
    "apps",
    ...(appsExpanded ? descendants("apps") : []),
    "settings",
    ...(settingsExpanded ? descendants("settings") : []),
  ];
  const activateParent = (id: StaticParent) => {
    const disclosure = disclosures[id];
    const active = tabs.active === id && (id !== "settings" || settingsSection === null);
    const next = parentActivation(active, disclosure.open);
    disclosure.set(next.expanded);
    if (next.navigate) {
      if (id === "settings") onSettingsSectionSelect(null);
      onSelect(id);
    }
  };
  const visible = destinations.filter(
    (id) =>
      database ||
      id === "relay" ||
      id === "tables" ||
      id === "advanced" ||
      isSettingsSection(id) ||
      pageAvailable(id, database),
  );
  const afterChat = visible[visible.indexOf("chat") + 1];
  const afterRelay = pageAvailable("search", database) ? "search" : "chat";
  const relayButtons = () =>
    [...document.querySelectorAll<HTMLButtonElement>(".relay-sidebar button:enabled")].filter(
      (button) => !button.closest("[hidden]"),
    );
  const chatButtons = () =>
    [...document.querySelectorAll<HTMLButtonElement>("#chat-pages button:enabled")].filter(
      (button) => !button.closest("[hidden]"),
    );
  const selectConversation = (id: string) => {
    void navigation.open({ kind: "conversation", id });
  };
  function moveTo(target: (typeof visible)[number] | undefined, activate = true) {
    if (target === "relay") {
      relayButtons()[0]?.focus();
    } else if (target === "tables" || target === "advanced" || target === "experiments") {
      if (activate) onSelect(target);
      document.getElementById(`${target}-toggle`)?.focus();
    } else if (target && isSettingsSection(target)) {
      if (activate) {
        onSelect("settings");
        onSettingsSectionSelect(target);
      }
      document.getElementById(`tab-settings-${target}`)?.focus();
    } else if (target) {
      if (target === "chat") {
        if (activate) onSelect("projects");
        document.getElementById("tab-chat")?.focus();
        return;
      }
      if (activate) {
        if (target === "settings") onSettingsSectionSelect(null);
        onSelect(target);
      }
      document.getElementById(`tab-${target}`)?.focus();
    }
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, id: (typeof visible)[number]) {
    // A delayed reveal must not undo a subsequent keyboard navigation.
    if (navigationFrame.current !== undefined) {
      cancelAnimationFrame(navigationFrame.current);
      navigationFrame.current = undefined;
    }
    if (id === afterRelay && event.key === "ArrowUp") {
      const lastRelayButton = relayButtons().at(-1);
      if (lastRelayButton) {
        event.preventDefault();
        lastRelayButton.focus();
        return;
      }
    }
    if (id === afterChat && event.key === "ArrowUp" && chatExpanded) {
      const lastChild = chatButtons().at(-1);
      if (lastChild) {
        event.preventDefault();
        lastChild.focus();
        return;
      }
    }
    if (id === "chat" && event.key === "ArrowDown" && chatExpanded) {
      const child = chatButtons()[0];
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
    if (event.key === "ArrowLeft") {
      if (isParent(id)) {
        event.preventDefault();
        const disclosure = disclosures[id];
        if (disclosure.open) disclosure.set(false);
        else {
          const owner = navigationParent(id);
          if (owner) document.getElementById(sidebarPageElementId(owner))?.focus();
        }
        return;
      }
      const owner = isSettingsSection(id)
        ? "settings"
        : id === "relay"
          ? undefined
          : navigationParent(id);
      if (owner && isParent(owner)) {
        event.preventDefault();
        disclosures[owner].set(false);
        document.getElementById(sidebarPageElementId(owner))?.focus();
        return;
      }
    }
    if (event.key === "ArrowRight" && isParent(id)) {
      event.preventDefault();
      const disclosure = disclosures[id];
      if (disclosure.open)
        moveTo(
          childIds(id).find((child) => isSettingsSection(child) || pageAvailable(child, database)),
          false,
        );
      else disclosure.set(true);
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
        data-nav-active={
          (tabs.active === id &&
            (id !== "settings" || (settingsSection === null && settingsExpanded))) ||
          (id === "apps" && appActive && !appsExpanded)
        }
      >
        <button
          type="button"
          role="tab"
          id={`tab-${id}`}
          className={id === "apps" ? "page-group-toggle" : undefined}
          aria-controls={
            id === "settings"
              ? "panel-settings settings-pages"
              : id === "apps"
                ? "panel-apps app-pages"
                : `panel-${id}`
          }
          aria-expanded={
            id === "settings" ? settingsExpanded : id === "apps" ? appsExpanded : undefined
          }
          aria-selected={
            tabs.active === id &&
            (id !== "settings" || settingsSection === null || !settingsExpanded)
          }
          data-active={
            id === "apps" ? tabs.active === id || (appActive && !appsExpanded) : undefined
          }
          title={pageDefinitions[id].label}
          disabled={!pageAvailable(id, database)}
          tabIndex={
            tabs.active === id || (first && pageGroup(tabs.active) !== pageGroup(id)) ? 0 : -1
          }
          onClick={() => {
            if (id === "settings" || id === "apps") {
              activateParent(id);
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
          <NavigationIcon name={settingsIcons[id]} />
          <span className="page-tab-label">{settingsLabels[id]}</span>
        </button>
      </div>
    );
  }
  function staticChildrenPanel(parent: StaticParent) {
    const disclosure = disclosures[parent];
    return (
      <div
        id={disclosure.panel}
        className="page-tab-list page-group-pages"
        hidden={!disclosure.open}
        inert={!disclosure.open}
        aria-hidden={!disclosure.open}
      >
        <div role="tablist" aria-label={pageDefinitions[parent].label} aria-orientation="vertical">
          {childIds(parent).map((id) => {
            if (isSettingsSection(id)) return settingsPage(id);
            if (!isParent(id)) return page(id, true);
            const child = disclosures[id];
            const active =
              tabs.active === id || (inNavigationBranch(tabs.active, id) && !child.open);
            return (
              <div key={id}>
                <div className="page-tab" data-nav-active={active}>
                  <button
                    type="button"
                    id={sidebarPageElementId(id)}
                    className="page-group-toggle"
                    aria-expanded={child.open}
                    aria-controls={`panel-${id} ${child.panel}`}
                    aria-current={tabs.active === id ? "page" : undefined}
                    data-active={active}
                    onClick={() => activateParent(id)}
                    onKeyDown={(event) => navigate(event, id)}
                  >
                    {pageDefinitions[id].icon && <NavigationIcon name={pageDefinitions[id].icon} />}
                    <span className="page-tab-label">{pageDefinitions[id].label}</span>
                  </button>
                </div>
                {staticChildrenPanel(id)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <div className="page-tabs">
      <div role="tablist" aria-label="Home page" aria-orientation="vertical">
        {page("home", true)}
      </div>
      {relay && (
        <ChatSidebar
          relayNavigation
          chats={[relay]}
          runs={runs.filter((run) => run.relay)}
          selectedId={selectedId}
          navigationSerial={navigationSerial}
          database={database}
          eventsByRun={eventsByRun}
          open={tabs.active === "chat" && !navigation.projectPending}
          pending={chatPending}
          onSelect={selectConversation}
          onKeyDown={(event) => {
            if (event.defaultPrevented) return;
            const buttons = relayButtons();
            const index = buttons.indexOf(event.target as HTMLButtonElement);
            if (index < 0) return;
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
              if (next) next.focus();
              else moveTo(event.key === "ArrowDown" ? afterRelay : "home");
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              moveTo(event.key === "Home" ? visible[0] : visible.at(-1));
            }
          }}
        />
      )}
      <div role="tablist" aria-label="Search page" aria-orientation="vertical">
        {page("search", false)}
      </div>
      <div
        className="chat-page-heading"
        data-nav-active={tabs.active === "projects" || (tabs.active === "project" && !chatExpanded)}
      >
        <div
          className="page-tab"
          role="tablist"
          aria-label="Projects page"
          aria-orientation="vertical"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tabs.active === "projects"}
            title="Projects"
            id="tab-chat"
            className="page-group-toggle"
            aria-expanded={chatExpanded}
            aria-controls="panel-projects chat-pages"
            data-active={tabs.active === "projects" || (tabs.active === "project" && !chatExpanded)}
            onClick={() => {
              const next = parentActivation(tabs.active === "projects", chatExpanded);
              setChatExpanded(next.expanded);
              if (next.navigate) onSelect("projects");
            }}
            onKeyDown={(event) => navigate(event, "chat")}
          >
            {pageDefinitions.projects.icon && (
              <NavigationIcon name={pageDefinitions.projects.icon} />
            )}
            <span className="page-tab-label">{pageDefinitions.projects.label}</span>
          </button>
        </div>
        <button
          type="button"
          className="icon-button project-sidebar-open"
          aria-label={database ? "Open Project" : "Connect to database"}
          title={database ? "Open Project" : "Connect to database"}
          aria-haspopup="dialog"
          disabled={projectDisabled}
          onClick={onOpenProject}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              document.getElementById("tab-chat")?.focus();
            } else if (["ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              navigate(event, "chat");
          }}
        >
          <Icon name="add" />
        </button>
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
              moveTo(visible[0]);
              return;
            }
            if (event.key === "End") {
              moveTo(visible.at(-1));
              return;
            }
            const next = index + (event.key === "ArrowDown" ? 1 : -1);
            if (next >= buttons.length) moveTo(afterChat);
            else buttons[next]?.focus();
          }
        }}
      >
        {openProjects ? (
          <ProjectChatSidebar
            projects={openProjects}
            selectedProjectId={selectedProjectId}
            onProjectAction={projectAction}
            homeProjectId={tabs.active === "project" ? tabs.projectId : undefined}
            onProjectOpen={(id) => void navigation.open({ kind: "project", id })}
            onAction={chatAction}
            chats={chats}
            runs={runs}
            selectedId={selectedId}
            navigationSerial={navigationSerial}
            database={database}
            eventsByRun={eventsByRun}
            open={tabs.active === "chat" && !navigation.projectPending}
            pending={chatPending}
            onSelect={selectConversation}
          />
        ) : (
          <ChatSidebar
            onAction={chatAction}
            chats={chats.filter((chat) => chat.kind !== "relay")}
            runs={runs.filter((run) => !run.relay)}
            selectedId={selectedId}
            navigationSerial={navigationSerial}
            database={database}
            eventsByRun={eventsByRun}
            open={tabs.active === "chat" && !navigation.projectPending}
            pending={chatPending}
            onSelect={selectConversation}
          />
        )}
      </div>
      <div role="tablist" aria-label="Apps page" aria-orientation="vertical">
        {page("apps", true)}
      </div>
      {staticChildrenPanel("apps")}
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
        </div>
        {staticChildrenPanel("settings")}
      </div>{" "}
    </div>
  );
}
