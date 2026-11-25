import {
  Button,
  Header,
  HeaderMenuButton,
  HeaderName,
  SideNav,
  SideNavItems,
  SideNavMenu,
  SkipToContent,
} from "@carbon/react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { DesktopRun, OpenProject, OrchestrationChat } from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
import type { Theme } from "./appearance.js";
import { Button as AppButton } from "./carbon/button.js";
import { Checkbox } from "./carbon/choices.js";
import { Select as CarbonSelect } from "./carbon/fields.js";
import { Surface as Card } from "./carbon/surfaces.js";
import { ChatSidebar } from "./chat-sidebar.js";
import { conversationId } from "./chats.js";
import { Icon } from "./icons.js";
import { Modal } from "./modal.js";
import {
  isSettingsSection,
  pageAvailable,
  pageDefinitions,
  settingsIcons,
  settingsLabels,
} from "./navigation.js";
import type { NavigationActions } from "./navigation-actions.js";
import { NavigationIcon } from "./navigation-icons.js";
import { sidebarPageElementId } from "./navigation-tree.js";
import { ProjectChatSidebar } from "./project-chat-sidebar.js";
import { RelayPulse } from "./relay-pulse.js";

import type { PageId, PageTabs, SettingsSectionId } from "./tabs.js";

export function PageTabBar({
  relayListening = false,
  showRelayDot,
  onShowRelayDotChange,
  commands,
  workspace,
  connected,
  theme,
  onThemeChange,
  tabs,
  settingsSection,
  onSelect,
  onSettingsSectionSelect,
  onOpenProject,
  onConnectDatabase,
  projectDisabled,
  navigation,
  customAgents = [],
  chats,
  runs,
  selectedId,
  navigationSerial,
  database,
  eventsByRun,
  openProjects,
  selectedProjectId,
  canGoBack = false,
  canGoForward = false,
  onBack = () => {},
  onForward = () => {},
}: {
  relayListening?: boolean;
  showRelayDot: boolean;
  onShowRelayDotChange(show: boolean): void;
  commands?(): void;
  workspace?(close: () => void): import("react").ReactNode;
  connected?: boolean | undefined;
  theme: Theme;
  onThemeChange(theme: Theme): void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onBack?(): void;
  onForward?(): void;
  tabs: PageTabs;
  settingsSection: SettingsSectionId | null;
  onSelect(id: PageId): void;
  onSettingsSectionSelect(id: SettingsSectionId | null): void;
  onOpenProject(): void;
  onConnectDatabase?(): void;
  projectDisabled: boolean;
  navigation: NavigationActions;
  customAgents?: readonly import("../bridge/index.js").CustomAgentSummary[] | undefined;
  chats: readonly OrchestrationChat[];
  runs: readonly DesktopRun[];
  selectedId: string | undefined;
  navigationSerial: number | undefined;
  database: string | null;
  eventsByRun: Readonly<Record<string, readonly RunEvent[]>>;
  openProjects?: readonly OpenProject[] | undefined;
  selectedProjectId?: string | null | undefined;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [utilities, setUtilities] = useState(false);
  const closeNavigation = () => setMobileOpen(false);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 66rem)");
    const resize = () => {
      if (wide.matches) setMobileOpen(false);
    };
    wide.addEventListener("change", resize);
    return () => wide.removeEventListener("change", resize);
  }, []);
  return (
    <>
      <Header aria-label="Code60" className="product-header">
        <SkipToContent
          href={`#panel-${tabs.active}`}
          onClick={(event) => {
            event.preventDefault();
            document.getElementById(`panel-${tabs.active}`)?.focus();
          }}
        />
        <HeaderMenuButton
          aria-label={mobileOpen ? "Close product navigation" : "Open product navigation"}
          isActive={mobileOpen}
          aria-expanded={mobileOpen}
          aria-controls="navigation-sidebar"
          onClick={() => setMobileOpen(!mobileOpen)}
        />
        <HeaderName
          prefix=""
          href="#panel-home"
          onClick={(event) => {
            event.preventDefault();
            closeNavigation();
            onSelect("home");
          }}
        >
          Code60
        </HeaderName>
        <HistoryControls
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onBack={onBack}
          onForward={onForward}
        />
        <Checkbox
          className="relay-dot-toggle"
          labelText="relay animation"
          hideLabel
          title="relay animation"
          checked={showRelayDot}
          onChange={(_event, { checked }) => onShowRelayDotChange(checked)}
        />
        <div className="product-utilities">
          {connected !== undefined && (
            <span role="status">
              {connected ? "Backend connected" : "Reconnecting to backend…"}
            </span>
          )}
          <Button size="md" kind="ghost" onClick={commands} title="Commands" aria-label="Commands">
            <Icon name="terminal" className="commands-icon" />
            <span className="commands-label">Commands</span>
          </Button>
          <Button size="md" kind="ghost" aria-haspopup="dialog" onClick={() => setUtilities(true)}>
            Workspace
          </Button>
        </div>
      </Header>
      <SideNav
        id="navigation-sidebar"
        aria-busy={navigation.busy || undefined}
        className="product-navigation"
        aria-label="Product navigation"
        expanded={mobileOpen}
        onOverlayClick={closeNavigation}
        onSideNavBlur={closeNavigation}
        onClick={(event) => {
          if (
            (event.target as HTMLElement).closest(
              '[role="tab"], .chat-sidebar-entry, .project-home-link',
            )
          )
            closeNavigation();
        }}
      >
        <div id="navigation-sidebar-content">
          {showRelayDot && (
            <RelayPulse
              chat={chats.find((chat) => chat.kind === "relay" && !chat.customAgentId)}
              connected={!!connected}
              listening={relayListening}
            />
          )}
          <PageTabList
            onOpenProject={database ? onOpenProject : (onConnectDatabase ?? onOpenProject)}
            projectDisabled={projectDisabled}
            tabs={tabs}
            settingsSection={settingsSection}
            onSelect={onSelect}
            onSettingsSectionSelect={onSettingsSectionSelect}
            navigation={navigation}
            customAgents={customAgents}
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
      </SideNav>
      {utilities && (
        <Modal
          passive
          initialFocus=".cds--list-box button, select"
          busy={false}
          title="Workspace"
          onClose={() => setUtilities(false)}
        >
          <div className="product-workspace-actions">
            <CarbonSelect
              labelText="Color theme"
              aria-label="Color theme"
              value={theme}
              onChange={(e) => onThemeChange(e.target.value as Theme)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </CarbonSelect>
            {workspace?.(() => setUtilities(false))}
          </div>
        </Modal>
      )}
    </>
  );
}

type HistoryDirection = "back" | "forward";

function HistoryControls({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack(): void;
  onForward(): void;
}) {
  const back = useRef<HTMLButtonElement>(null);
  const forward = useRef<HTMLButtonElement>(null);
  // The browser drops focus as soon as a button becomes disabled, so remember which one the
  // user pressed and hand focus to its sibling, or to Chat, when it runs out of destinations.
  const pressed = useRef<HistoryDirection | undefined>(undefined);
  useEffect(() => {
    const direction = pressed.current;
    pressed.current = undefined;
    if (!direction) return;
    const [button, enabled, sibling, siblingEnabled] =
      direction === "back"
        ? [back.current, canGoBack, forward.current, canGoForward]
        : [forward.current, canGoForward, back.current, canGoBack];
    const focused = document.activeElement;
    if (enabled || (focused !== button && focused !== document.body && focused !== null)) return;
    (siblingEnabled ? sibling : document.getElementById("tab-chat"))?.focus();
  }, [canGoBack, canGoForward]);
  const press = (direction: HistoryDirection, go: () => void) => () => {
    pressed.current = direction;
    go();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a toolbar of two buttons, not a form fieldset.
    <div className="sidebar-history" role="group" aria-label="Navigation history">
      <AppButton
        ref={back}
        type="button"
        className="icon-button"
        aria-label="Back"
        title="Back"
        disabled={!canGoBack}
        onClick={press("back", onBack)}
      >
        <Icon name="arrow--left" />
      </AppButton>
      <AppButton
        ref={forward}
        type="button"
        className="icon-button"
        aria-label="Forward"
        title="Forward"
        disabled={!canGoForward}
        onClick={press("forward", onForward)}
      >
        <Icon name="arrow--right" />
      </AppButton>
    </div>
  );
}

const sidebarGroups = {
  Chat: ["relay", "custom-agents"],
  Develop: ["projects", "workflows"],
  Automate: ["automations"],
  Connect: ["mcp-servers", "providers"],
  Customize: ["prompts", "commands", "customize-mcp-servers"],
  Personalize: ["appearance", "table-defaults", "text"],
  Manage: ["about", "health-check", "polling-settings", "system-manager", "updates"],
  "Contributor Tools": ["episodic-memory", "rag"],
  Experiments: ["web-server"],
} as const satisfies Record<
  string,
  readonly (PageId | SettingsSectionId | "relay" | "customize-mcp-servers")[]
>;

type NavigationGroup = keyof typeof sidebarGroups;
type SidebarItem = (typeof sidebarGroups)[NavigationGroup][number];
const groupNames = Object.keys(sidebarGroups) as NavigationGroup[];

function NavigationSection({
  title,
  destination,
  children,
}: {
  title: NavigationGroup;
  destination: string | undefined;
  children: ReactNode;
}) {
  const button = useRef<HTMLButtonElement>(null);
  // Carbon owns disclosure state. Reveal an externally selected route through
  // its toggle, preserving mounted project rows and any other open menus.
  useLayoutEffect(() => {
    if (destination && button.current?.getAttribute("aria-expanded") === "false")
      button.current.click();
  }, [destination]);
  return (
    <SideNavMenu
      id={`nav-group-${title.replaceAll(" ", "-")}`}
      title={title}
      ref={button}
      defaultExpanded={Boolean(destination)}
      isActive={Boolean(destination)}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) button.current?.focus();
      }}
    >
      <li
        className="product-nav-destinations"
        onKeyDown={(event) => {
          // Portal events bubble through React. Let a sidebar dialog handle its
          // own Escape without also closing the menu behind it.
          if (event.key === "Escape" && !event.currentTarget.contains(event.target as Node))
            event.stopPropagation();
        }}
      >
        {children}
      </li>
    </SideNavMenu>
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
  customAgents = [],
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
  customAgents?: readonly import("../bridge/index.js").CustomAgentSummary[] | undefined;
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
  const relay = chats.find((chat) => chat.kind === "relay" && !chat.customAgentId);
  const [customExpanded, setCustomExpanded] = useState(
    () => localStorage.getItem("code60.customAgentsExpanded") !== "false",
  );
  useEffect(() => {
    localStorage.setItem("code60.customAgentsExpanded", String(customExpanded));
  }, [customExpanded]);
  const selectedCustomAgent = chats.find(
    (chat) =>
      chat.customAgentId &&
      (conversationId(chat) === selectedId || chat.workers?.includes(selectedId ?? "")),
  )?.customAgentId;
  useEffect(() => {
    if (navigation.destination?.kind === "custom-agent" || selectedCustomAgent)
      setCustomExpanded(true);
  }, [navigation.destination, selectedCustomAgent]);
  const relayId = relay && conversationId(relay);
  const relaySelected = relayId !== undefined && relayId === selectedId;
  const [mcpItem, setMcpItem] = useState<"mcp-servers" | "customize-mcp-servers">("mcp-servers");
  function activeSidebarItem() {
    switch (tabs.active) {
      case "chat":
        if (selectedCustomAgent) return "custom-agents";
        if (relaySelected || relay?.workers?.includes(selectedId ?? "")) return "relay";
        return "projects";
      case "project":
        return "projects";
      case "mcp-servers":
        return mcpItem;
      case "settings":
        return settingsSection;
      default:
        return tabs.active;
    }
  }
  const activeItem = activeSidebarItem();
  const destinationFor = (group: NavigationGroup) =>
    sidebarGroups[group].some((item) => item === activeItem)
      ? JSON.stringify([
          activeItem,
          tabs.active,
          tabs.projectId,
          tabs.active === "chat" && selectedId,
        ])
      : undefined;
  useLayoutEffect(() => {
    if (selectedId && !relaySelected)
      document
        .querySelector("#chat-pages [aria-current='true']")
        ?.scrollIntoView({ block: "nearest" });
  }, [selectedId, relaySelected]);
  const visible = groupNames
    .flatMap<SidebarItem>((group) => [...sidebarGroups[group]])
    .filter((item) =>
      item === "relay"
        ? Boolean(relay && !chatPending)
        : item === "customize-mcp-servers" ||
          isSettingsSection(item) ||
          pageAvailable(item, database),
    );
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
  function moveTo(item: SidebarItem | undefined) {
    if (!item) return;
    const row = document.querySelector(`[data-sidebar-item="${item}"]`);
    const toggle = row?.closest("li[id^=nav-group-]")?.firstElementChild;
    if (toggle instanceof HTMLButtonElement && toggle.getAttribute("aria-expanded") === "false") {
      toggle.focus();
      return;
    }
    if (item === "relay") {
      relayButtons()[0]?.focus();
      return;
    }
    const button = row?.querySelector<HTMLButtonElement>('button[role="tab"]');
    if (button?.getAttribute("aria-selected") !== "true") button?.click();
    button?.focus();
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, id: SidebarItem) {
    if (id === "custom-agents" && event.key === "ArrowRight") {
      event.preventDefault();
      setCustomExpanded(true);
      document.querySelector<HTMLButtonElement>("#custom-agent-pages button")?.focus();
      return;
    }
    if (id === "custom-agents" && event.key === "ArrowLeft") {
      event.preventDefault();
      if (customExpanded) setCustomExpanded(false);
      else document.querySelector<HTMLButtonElement>("#nav-group-Chat > button")?.focus();
      return;
    }
    if (id === "custom-agents" && event.key === "ArrowDown" && customExpanded) {
      const first = document.querySelector<HTMLButtonElement>("#custom-agent-pages button:enabled");
      if (first) {
        event.preventDefault();
        first.focus();
        return;
      }
    }
    if (id === "custom-agents" && event.key === "ArrowUp") {
      const lastRelayButton = relayButtons().at(-1);
      if (lastRelayButton) {
        event.preventDefault();
        lastRelayButton.focus();
        return;
      }
    }
    if (id === "workflows" && event.key === "ArrowUp") {
      const lastChild = chatButtons().at(-1);
      if (lastChild) {
        event.preventDefault();
        lastChild.focus();
        return;
      }
    }
    if (id === "projects" && event.key === "ArrowDown") {
      const child = chatButtons()[0];
      if (child) {
        event.preventDefault();
        child.focus();
        return;
      }
    }
    if (id === "projects" && event.key === "ArrowRight") {
      event.preventDefault();
      chatButtons()[0]?.focus();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.currentTarget
        .closest("li[id^=nav-group-]")
        ?.querySelector<HTMLButtonElement>(":scope > button")
        ?.focus();
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
  function link(item: Exclude<SidebarItem, "relay">) {
    const id = item === "customize-mcp-servers" ? "mcp-servers" : item;
    const setting = isSettingsSection(id);
    const label = setting ? settingsLabels[id] : pageDefinitions[id].label;
    const selected = activeItem === item && (id !== "custom-agents" || tabs.active === id);
    const panel = setting ? `panel-settings-${id}` : `panel-${id}`;
    const icon = setting ? settingsIcons[id] : pageDefinitions[id].icon;
    return (
      <div className="page-tab" data-nav-active={selected}>
        <AppButton
          type="button"
          role="tab"
          id={
            setting
              ? `tab-settings-${id}`
              : id === "mcp-servers" && item !== mcpItem
                ? "tab-mcp-servers-alternate"
                : sidebarPageElementId(id)
          }
          aria-controls={id === "custom-agents" ? `${panel} custom-agent-pages` : panel}
          aria-expanded={id === "custom-agents" ? customExpanded : undefined}
          aria-selected={selected}
          title={label}
          disabled={!setting && !pageAvailable(id, database)}
          tabIndex={0}
          onClick={() => {
            if (isSettingsSection(id)) {
              onSettingsSectionSelect(id);
              onSelect("settings");
            } else if (id === "custom-agents" && tabs.active === id) {
              setCustomExpanded((open) => !open);
            } else {
              if (item === "mcp-servers" || item === "customize-mcp-servers") setMcpItem(item);
              if (id === "custom-agents") setCustomExpanded(true);
              onSelect(id);
            }
          }}
          onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => navigate(event, item)}
        >
          {icon && <NavigationIcon name={icon} />}
          <span className="page-tab-label">{label}</span>
        </AppButton>
      </div>
    );
  }
  function entry(item: SidebarItem) {
    switch (item) {
      case "relay":
        return relay ? (
          <ChatSidebar
            relayNavigation
            chats={[relay]}
            runs={runs.filter((run) => run.relay?.conversationId === relay.conversationId)}
            selectedId={selectedId}
            navigationSerial={navigationSerial}
            database={database}
            eventsByRun={eventsByRun}
            open={tabs.active === "chat"}
            conversationVisible={tabs.active === "chat" && !navigation.projectPending}
            pending={chatPending}
            ancestorsExpanded={true}
            onSelect={selectConversation}
            onKeyDown={(event) => {
              if (event.defaultPrevented) return;
              const buttons = relayButtons();
              const index = buttons.indexOf(event.target as HTMLButtonElement);
              if (index < 0) return;
              if (event.key === "ArrowLeft" && index === 0) {
                event.preventDefault();
                document.querySelector<HTMLButtonElement>("#nav-group-Chat > button")?.focus();
              } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                event.preventDefault();
                const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
                if (next) next.focus();
                else if (event.key === "ArrowDown") moveTo("custom-agents");
                else document.querySelector<HTMLButtonElement>("#nav-group-Chat > button")?.focus();
              } else if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                moveTo(event.key === "Home" ? visible[0] : visible.at(-1));
              }
            }}
          />
        ) : (
          <div className="page-tab">
            <AppButton role="tab" aria-selected={false} disabled>
              Relay
            </AppButton>
          </div>
        );
      case "custom-agents":
        return (
          <>
            {link(item)}
            {/* biome-ignore lint/a11y/useSemanticElements: navigation disclosure, not a form fieldset. */}
            <div
              role="group"
              aria-label="Custom assistant conversations"
              id="custom-agent-pages"
              aria-hidden={!customExpanded}
              className="page-group-pages"
              hidden={!customExpanded}
              inert={!customExpanded}
              onKeyDown={(event) => {
                if (event.defaultPrevented) return;
                const buttons = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:enabled"),
                ].filter((button) => !button.closest("[hidden]"));
                const index = buttons.indexOf(event.target as HTMLButtonElement);
                if (index < 0) return;
                if (event.key === "ArrowLeft" || (event.key === "ArrowUp" && index === 0)) {
                  event.preventDefault();
                  if (event.key === "ArrowLeft") setCustomExpanded(false);
                  document.getElementById("tab-custom-agents")?.focus();
                } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
                  if (next) next.focus();
                  else moveTo("projects");
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  moveTo(event.key === "Home" ? visible[0] : visible.at(-1));
                }
              }}
            >
              {customAgents
                .filter((agent) => !agent.archived)
                .map((agent) => {
                  const chat = chats.find((chat) => chat.customAgentId === agent.id);
                  return chat && conversationId(chat) ? (
                    <ChatSidebar
                      key={agent.id}
                      chats={[chat]}
                      runs={runs.filter((run) => run.relay?.conversationId === chat.conversationId)}
                      selectedId={selectedId}
                      navigationSerial={navigationSerial}
                      database={database}
                      eventsByRun={eventsByRun}
                      open={tabs.active === "chat"}
                      pending={chatPending}
                      conversationVisible={tabs.active === "chat" && !navigation.projectPending}
                      onSelect={selectConversation}
                      ancestorsExpanded={customExpanded}
                    />
                  ) : (
                    <div key={agent.id} className="chat-sidebar-row">
                      <AppButton
                        type="button"
                        className="chat-sidebar-entry"
                        disabled={chatPending}
                        onClick={() => void navigation.open({ kind: "custom-agent", id: agent.id })}
                      >
                        <span className="chat-sidebar-artwork" aria-hidden="true">
                          <NavigationIcon name="app-custom-agents" />
                        </span>
                        <span className="chat-sidebar-label">{agent.name}</span>
                      </AppButton>
                    </div>
                  );
                })}
            </div>
          </>
        );
      case "projects":
        return (
          <Card size="sm" className="sidebar-navigation-card sidebar-section">
            <div
              className="chat-page-heading sidebar-card-header"
              data-nav-active={tabs.active === "projects"}
            >
              <div
                className="page-tab"
                role="tablist"
                aria-label="Projects page"
                aria-orientation="vertical"
              >
                <AppButton
                  type="button"
                  role="tab"
                  aria-selected={tabs.active === "projects"}
                  title="Projects"
                  id="tab-chat"
                  className="page-group-toggle"
                  aria-controls="panel-projects"
                  data-active={tabs.active === "projects"}
                  onClick={() => onSelect("projects")}
                  onKeyDown={(event) => navigate(event, "projects")}
                >
                  {pageDefinitions.projects.icon && (
                    <NavigationIcon name={pageDefinitions.projects.icon} />
                  )}
                  <span className="page-tab-label">{pageDefinitions.projects.label}</span>
                </AppButton>
              </div>
            </div>
            <AppButton
              type="button"
              className="icon-button project-sidebar-open"
              aria-label="Add Project"
              title={database ? "Add Project" : "Connect to database to add a project"}
              aria-haspopup="dialog"
              disabled={projectDisabled}
              onClick={onOpenProject}
            >
              <span className="sidebar-card-add" aria-hidden="true">
                <Icon name="add" />
              </span>
            </AppButton>
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
              onKeyDown={(event) => {
                const buttons = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button:not(:disabled)",
                  ),
                ].filter((button) => !button.closest("[hidden]"));
                const index = buttons.indexOf(event.target as HTMLButtonElement);
                if (index < 0) return;
                if (event.key === "ArrowLeft" || (event.key === "ArrowUp" && index === 0)) {
                  event.preventDefault();
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
                  if (next >= buttons.length) moveTo("workflows");
                  else buttons[next]?.focus();
                }
              }}
            >
              {openProjects ? (
                <ProjectChatSidebar
                  ancestorsExpanded={true}
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
                  open={tabs.active === "chat"}
                  conversationVisible={tabs.active === "chat" && !navigation.projectPending}
                  pending={chatPending}
                  onSelect={selectConversation}
                />
              ) : (
                <ChatSidebar
                  ancestorsExpanded={true}
                  onAction={chatAction}
                  chats={chats.filter((chat) => chat.kind !== "relay")}
                  runs={runs.filter((run) => !run.relay)}
                  selectedId={selectedId}
                  navigationSerial={navigationSerial}
                  database={database}
                  eventsByRun={eventsByRun}
                  open={tabs.active === "chat"}
                  conversationVisible={tabs.active === "chat" && !navigation.projectPending}
                  pending={chatPending}
                  onSelect={selectConversation}
                />
              )}
            </div>
          </Card>
        );
      default:
        return link(item);
    }
  }
  return (
    <SideNavItems className="page-tabs">
      {groupNames.map((group) => (
        <NavigationSection key={group} title={group} destination={destinationFor(group)}>
          <div role="tablist" aria-label={group} aria-orientation="vertical">
            {sidebarGroups[group].map((item) => (
              <div key={item} data-sidebar-item={item}>
                {entry(item)}
              </div>
            ))}
          </div>
        </NavigationSection>
      ))}
    </SideNavItems>
  );
}
