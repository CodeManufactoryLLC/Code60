import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DesktopRun, OpenProject, OrchestrationChat } from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
import type { Theme } from "./appearance.js";
import { ChatSidebar } from "./chat-sidebar.js";
import { conversationId } from "./chats.js";
import { IconAnimationToggle } from "./icon-animation-toggle.js";
import { Icon } from "./icons.js";
import {
  isSettingsSection,
  pageAvailable,
  pageDefinitions,
  pageGroup,
  settingsIcons,
  settingsLabels,
  settingsParents,
} from "./navigation.js";
import type { NavigationActions } from "./navigation-actions.js";
import { NavigationIcon } from "./navigation-icons.js";
import {
  conversationProject,
  inNavigationBranch,
  navigationParent,
  parentActivation,
  sidebarPageElementId,
  staticChildren,
} from "./navigation-tree.js";
import { Card } from "./neobrutalism/card.js";
import { ProjectChatSidebar } from "./project-chat-sidebar.js";
import type { ProviderManagement } from "./provider-management.js";
import { ProvidersSidebar } from "./providers-sidebar.js";
import { observeSidebarCardEdges, observeWorkspaceInset } from "./sidebar-layout.js";
import type { PageId, PageTabs, SettingsSectionId } from "./tabs.js";
import { ThemeToggle } from "./theme-toggle.js";

export function PageTabBar({
  iconAnimations,
  iconAnimationsSaved = true,
  onIconAnimationsChange,
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
  providerSetup,
  providerManagement,
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
  iconAnimations: boolean;
  iconAnimationsSaved?: boolean;
  onIconAnimationsChange(enabled: boolean): void;
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
  providerSetup?: import("../bridge/index.js").AgentSetupSnapshot | undefined;
  providerManagement?: ProviderManagement | undefined;
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
    if (sidebar.current) return observeSidebarCardEdges(sidebar.current);
  }, []);
  useLayoutEffect(() => {
    const workspace = sidebar.current?.closest<HTMLElement>(".app-workspace");
    if (!workspace) return;
    const notice = database ? null : workspace.parentElement?.querySelector(".database-notice");
    return observeWorkspaceInset(workspace, notice ?? null);
  }, [database]);
  const sidebarInset = () =>
    sidebar.current ? Number.parseFloat(getComputedStyle(sidebar.current).paddingLeft) || 0 : 0;
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
        aria-busy={navigation.busy || undefined}
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
              (sidebar.current?.getBoundingClientRect().width ?? width) -
                sidebarInset() +
                (event.key === "ArrowRight" ? 20 : -20),
            );
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId) && sidebar.current)
              resize(event.clientX - sidebar.current.getBoundingClientRect().left - sidebarInset());
          }}
          onPointerUp={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            if (sidebar.current)
              resize(event.clientX - sidebar.current.getBoundingClientRect().left - sidebarInset());
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        />
        <div id="navigation-sidebar-content" className="sidebar-content">
          <PageTabList
            sidebarOpen={open}
            onOpenProject={database ? onOpenProject : (onConnectDatabase ?? onOpenProject)}
            projectDisabled={projectDisabled}
            tabs={tabs}
            settingsSection={settingsSection}
            onSelect={onSelect}
            onSettingsSectionSelect={onSettingsSectionSelect}
            navigation={navigation}
            providerSetup={providerSetup}
            providerManagement={providerManagement}
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
      </nav>
      <header className="workspace-header">
        <Card className="workspace-breadcrumbs">
          <HistoryControls
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            onBack={onBack}
            onForward={onForward}
          />
          <div className="breadcrumb-appearance-controls">
            <IconAnimationToggle
              enabled={iconAnimations}
              saved={iconAnimationsSaved}
              onChange={onIconAnimationsChange}
            />
            <ThemeToggle theme={theme} onChange={onThemeChange} />
          </div>
        </Card>
      </header>
      <div className="workspace-panel-controls">
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
        <div id="workspace-panel-actions" />
      </div>
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
      <button
        ref={back}
        type="button"
        className="icon-button"
        aria-label="Back"
        title="Back"
        disabled={!canGoBack}
        onClick={press("back", onBack)}
      >
        {canGoBack ? (
          <NavigationIcon name="app-history-back" />
        ) : (
          <span className="history-placeholder" aria-hidden="true" />
        )}
      </button>
      <button
        ref={forward}
        type="button"
        className="icon-button"
        aria-label="Forward"
        title="Forward"
        disabled={!canGoForward}
        onClick={press("forward", onForward)}
      >
        {canGoForward ? (
          <NavigationIcon name="app-history-forward" />
        ) : (
          <span className="history-placeholder" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

function PageTabList({
  sidebarOpen,
  onOpenProject,
  projectDisabled,
  tabs,
  settingsSection,
  onSelect,
  onSettingsSectionSelect,
  navigation,
  providerSetup,
  providerManagement,
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
  sidebarOpen: boolean;
  onOpenProject(): void;
  projectDisabled: boolean;
  tabs: PageTabs;
  settingsSection: SettingsSectionId | null;
  onSelect(id: PageId): void;
  onSettingsSectionSelect(id: SettingsSectionId | null): void;
  navigation: NavigationActions;
  providerSetup?: import("../bridge/index.js").AgentSetupSnapshot | undefined;
  providerManagement?: ProviderManagement | undefined;
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
  const [providersExpanded, setProvidersExpanded] = useState(
    () => localStorage.getItem("code60.providersExpanded") !== "false",
  );
  useEffect(() => {
    localStorage.setItem("code60.providersExpanded", String(providersExpanded));
  }, [providersExpanded]);
  useLayoutEffect(() => {
    if (tabs.active === "provider" && tabs.providerId) setProvidersExpanded(true);
  }, [tabs.active, tabs.providerId]);
  const { pending: chatPending, error: chatError, chatAction, projectAction } = navigation;
  const [homeExpanded, setHomeExpanded] = useState(
    () => localStorage.getItem("code60.homeExpanded") !== "false",
  );
  useEffect(() => {
    localStorage.setItem("code60.homeExpanded", String(homeExpanded));
  }, [homeExpanded]);
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
  const [assistantsExpanded, setAssistantsExpanded] = useState(
    () => localStorage.getItem("code60.assistantsExpanded") !== "false",
  );
  const assistantActive =
    tabs.active === "custom-agents" ||
    (tabs.active === "chat" &&
      (relaySelected || relay?.workers?.includes(selectedId ?? "") || !!selectedCustomAgent));
  useEffect(() => {
    localStorage.setItem("code60.assistantsExpanded", String(assistantsExpanded));
  }, [assistantsExpanded]);
  const previousAssistantNavigation = useRef({ tabs, selectedId, navigationSerial });
  useLayoutEffect(() => {
    const previous = previousAssistantNavigation.current;
    previousAssistantNavigation.current = { tabs, selectedId, navigationSerial };
    if (
      previous.tabs === tabs &&
      previous.selectedId === selectedId &&
      previous.navigationSerial === navigationSerial
    )
      return;
    if (assistantActive) setAssistantsExpanded(true);
    if (tabs.active === "chat" && selectedCustomAgent) setCustomExpanded(true);
  }, [assistantActive, tabs, selectedCustomAgent, selectedId, navigationSerial]);
  const setAssistantsDisclosure = (open: boolean) => {
    setAssistantsExpanded(open);
    if (!open) setCustomExpanded(false);
  };
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
  const projectForConversation = (id: string | undefined) =>
    conversationProject(id, openProjects ?? [], chats, runs);
  const selectedConversationProject = projectForConversation(selectedId);
  const previousSelection = useRef({ id: selectedId, serial: navigationSerial });
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reveal explicit destinations, not unrelated tab-object replacements or Relay navigation.
  useLayoutEffect(() => {
    const previous = previousSelection.current;
    previousSelection.current = { id: selectedId, serial: navigationSerial };
    const changed = previous.id !== selectedId || previous.serial !== navigationSerial;
    const matches =
      navigation.destination?.kind !== "conversation" || navigation.destination.id === selectedId;
    if (changed && matches && tabs.active === "chat" && selectedConversationProject)
      setChatExpanded(true);
  }, [selectedId, navigationSerial, selectedConversationProject]);
  useLayoutEffect(() => {
    if (tabs.active === "project") setChatExpanded(true);
  }, [tabs.active]);
  const destinationProject =
    navigation.destination?.kind === "project"
      ? navigation.destination.id
      : navigation.destination?.kind === "conversation"
        ? projectForConversation(navigation.destination.id)
        : undefined;
  useLayoutEffect(() => {
    if (navigation.destination && destinationProject) setChatExpanded(true);
  }, [navigation.destination, destinationProject]);
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
  const sectionParent =
    tabs.active === "settings" && settingsSection !== null
      ? settingsParents[settingsSection]
      : undefined;
  const appActive = inNavigationBranch(tabs.active, "apps") || sectionParent === "apps";
  const settingsActive = (tabs.active === "settings" && sectionParent !== "apps") || advancedActive;
  const activeGroup = sectionParent ?? pageGroup(tabs.active);
  useLayoutEffect(() => {
    const activeChanged = previousActivePage.current !== tabs.active;
    previousActivePage.current = tabs.active;
    if (sectionParent === "settings" || (activeChanged && advancedActive))
      setSettingsExpanded(true);
    if (appActive && tabs.active !== "apps") setAppsExpanded(true);
    if (tabs.active === "search") setHomeExpanded(true);
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
      const target = document.getElementById(id);
      if (target !== document.activeElement) target?.focus();
    });
    return () => {
      if (navigationFrame.current !== undefined) cancelAnimationFrame(navigationFrame.current);
    };
  }, [
    tabs,
    settingsSection,
    sectionParent,
    appActive,
    tableActive,
    advancedActive,
    experimentActive,
  ]);
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
  const setDisclosure = (id: StaticParent, open: boolean) => {
    disclosures[id].set(open);
    if (!open) for (const child of childIds(id)) if (isParent(child)) setDisclosure(child, false);
  };
  const descendants = (parent: StaticParent): (PageId | SettingsSectionId)[] =>
    childIds(parent).flatMap((id) => [
      id,
      ...(isParent(id) && disclosures[id].open ? descendants(id) : []),
    ]);
  const destinations: (PageId | SettingsSectionId | "relay" | "assistants")[] = [
    "home",
    ...(homeExpanded ? ["search" as const] : []),
    "assistants",
    ...(assistantsExpanded
      ? [...(relay && !chatPending ? ["relay" as const] : []), "custom-agents" as const]
      : []),
    "chat",
    "providers",
    "apps",
    ...(appsExpanded ? descendants("apps") : []),
    "settings",
    ...(settingsExpanded ? descendants("settings") : []),
  ];
  const activateParent = (id: StaticParent) => {
    const disclosure = disclosures[id];
    const active = tabs.active === id && (id !== "settings" || settingsSection === null);
    const next = parentActivation(active, disclosure.open);
    setDisclosure(id, next.expanded);
    if (next.navigate) {
      if (id === "settings") onSettingsSectionSelect(null);
      onSelect(id);
    }
  };
  const visible = destinations.filter(
    (id) =>
      database ||
      id === "assistants" ||
      id === "relay" ||
      id === "tables" ||
      id === "advanced" ||
      isSettingsSection(id) ||
      pageAvailable(id, database),
  );
  const afterChat = visible[visible.indexOf("chat") + 1];
  const afterRelay = "custom-agents";
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
    if (target === "assistants") {
      if (activate) onSelect("assistants");
      document.getElementById("tab-assistants")?.focus();
    } else if (target === "relay") {
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
    const providerButtons = () => [
      ...document.querySelectorAll<HTMLButtonElement>("#provider-pages button:enabled"),
    ];
    if (id === "providers" && ["ArrowLeft", "ArrowRight", "ArrowDown"].includes(event.key)) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setProvidersExpanded(false);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (providersExpanded) providerButtons()[0]?.focus();
        else setProvidersExpanded(true);
        return;
      }
      if (providersExpanded && providerButtons()[0]) {
        event.preventDefault();
        providerButtons()[0]?.focus();
        return;
      }
    }
    if (id === "apps" && event.key === "ArrowUp" && providersExpanded && providerButtons().length) {
      event.preventDefault();
      providerButtons().at(-1)?.focus();
      return;
    }
    if (id === "home" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      if (event.key === "ArrowLeft") setHomeExpanded(false);
      else if (!homeExpanded) setHomeExpanded(true);
      else moveTo("search", false);
      return;
    }
    if (id === "search" && event.key === "ArrowLeft") {
      event.preventDefault();
      setHomeExpanded(false);
      moveTo("home", false);
      return;
    }
    if (id === "assistants" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      if (event.key === "ArrowLeft") setAssistantsDisclosure(false);
      else if (!assistantsExpanded) setAssistantsDisclosure(true);
      else document.querySelector<HTMLButtonElement>("#assistants-pages button:enabled")?.focus();
      return;
    }
    if (id === "custom-agents" && event.key === "ArrowRight") {
      event.preventDefault();
      setCustomExpanded(true);
      document.querySelector<HTMLButtonElement>("#custom-agent-pages button")?.focus();
      return;
    }
    if (id === "custom-agents" && event.key === "ArrowLeft") {
      event.preventDefault();
      if (customExpanded) setCustomExpanded(false);
      else document.getElementById("assistants-toggle")?.focus();
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
    if (id === "chat" && event.key === "ArrowUp" && assistantsExpanded && customExpanded) {
      const last = [
        ...document.querySelectorAll<HTMLButtonElement>("#custom-agent-pages button:enabled"),
      ]
        .filter((b) => !b.closest("[hidden]"))
        .at(-1);
      if (last) {
        event.preventDefault();
        last.focus();
        return;
      }
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
      if (chatExpanded) chatButtons()[0]?.focus();
      else setChatExpanded(true);
      return;
    }
    if (event.key === "ArrowLeft") {
      if (isParent(id)) {
        event.preventDefault();
        const disclosure = disclosures[id];
        if (disclosure.open) setDisclosure(id, false);
        else {
          const owner = navigationParent(id);
          if (owner) document.getElementById(sidebarPageElementId(owner))?.focus();
        }
        return;
      }
      const owner = isSettingsSection(id)
        ? settingsParents[id]
        : id === "relay" || id === "assistants"
          ? undefined
          : navigationParent(id);
      if (owner && isParent(owner)) {
        event.preventDefault();
        setDisclosure(owner, false);
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
            (id !== "settings" ||
              (settingsActive && settingsSection === null && settingsExpanded))) ||
          (id === "apps" && appActive && !appsExpanded) ||
          (id === "assistants" && assistantActive && !assistantsExpanded) ||
          (id === "home" && tabs.active === "search" && !homeExpanded)
        }
      >
        <button
          type="button"
          role="tab"
          id={`tab-${id}`}
          className={id === "apps" ? "page-group-toggle" : undefined}
          aria-controls={
            id === "custom-agents" ? "panel-custom-agents custom-agent-pages" : `panel-${id}`
          }
          aria-expanded={id === "custom-agents" ? customExpanded : undefined}
          aria-selected={
            tabs.active === id &&
            (id !== "settings" ||
              (settingsActive && (settingsSection === null || !settingsExpanded)))
          }
          data-active={
            id === "apps" ? tabs.active === id || (appActive && !appsExpanded) : undefined
          }
          title={pageDefinitions[id].label}
          disabled={!pageAvailable(id, database)}
          tabIndex={
            (tabs.active === id && (id !== "settings" || settingsActive)) ||
            (first && activeGroup !== pageGroup(id))
              ? 0
              : -1
          }
          onClick={() => {
            if (id === "custom-agents") {
              if (tabs.active === id) setCustomExpanded((v) => !v);
              else {
                setCustomExpanded(true);
                onSelect(id);
              }
              return;
            }
            if (id === "settings" || id === "apps") {
              if (id === "settings") onSettingsSectionSelect(null);
              onSelect(id);
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
  function cardToggle(
    id: string,
    label: string,
    panel: string,
    open: boolean,
    setOpen: (open: boolean) => void,
    target: (typeof visible)[number],
  ) {
    const action = `${open ? "Collapse" : "Expand"} ${label}`;
    return (
      <button
        type="button"
        id={id}
        className="icon-button sidebar-card-toggle"
        aria-label={action}
        data-tooltip=""
        aria-controls={panel}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => navigate(event, target)}
      >
        <span className="sidebar-card-chevron" aria-hidden="true">
          <Icon name="chevron--down" />
        </span>
      </button>
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
    <Card size="sm" className="page-tabs sidebar-navigation-card">
      <div className="sidebar-section">
        <div
          className="sidebar-card-header"
          role="tablist"
          aria-label="Home page"
          aria-orientation="vertical"
        >
          {page("home", true)}
        </div>
        {cardToggle(
          "home-card-toggle",
          "Home and Search",
          "home-pages",
          homeExpanded,
          setHomeExpanded,
          "home",
        )}
        <div
          id="home-pages"
          className="page-group-pages sidebar-home-pages"
          role="tablist"
          aria-label="Search page"
          aria-orientation="vertical"
          hidden={!homeExpanded}
          inert={!homeExpanded}
          aria-hidden={!homeExpanded}
        >
          {page("search", false)}
        </div>
      </div>
      <div className="sidebar-section">
        <div
          className="sidebar-card-header"
          role="tablist"
          aria-label="Assistants page"
          aria-orientation="vertical"
        >
          {page("assistants", true)}
        </div>
        {cardToggle(
          "assistants-toggle",
          "Assistants",
          "assistants-pages",
          assistantsExpanded,
          setAssistantsDisclosure,
          "assistants",
        )}
        {/* biome-ignore lint/a11y/useSemanticElements: navigation disclosure, not a form fieldset. */}
        <div
          role="group"
          aria-label="Assistants"
          id="assistants-pages"
          className="page-group-pages"
          hidden={!assistantsExpanded}
          inert={!assistantsExpanded}
          aria-hidden={!assistantsExpanded}
        >
          {relay && (
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
              ancestorsExpanded={assistantsExpanded}
              onSelect={selectConversation}
              onKeyDown={(event) => {
                if (event.defaultPrevented) return;
                const buttons = relayButtons();
                const index = buttons.indexOf(event.target as HTMLButtonElement);
                if (index < 0) return;
                if (event.key === "ArrowLeft" && index === 0) {
                  event.preventDefault();
                  moveTo("assistants", false);
                } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  const next = buttons[index + (event.key === "ArrowDown" ? 1 : -1)];
                  if (next) next.focus();
                  else moveTo(event.key === "ArrowDown" ? afterRelay : "assistants");
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  moveTo(event.key === "Home" ? visible[0] : visible.at(-1));
                }
              }}
            />
          )}
          <div role="tablist" aria-label="Custom Assistants page" aria-orientation="vertical">
            {page("custom-agents", false)}
          </div>
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
                else moveTo("chat");
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
                    ancestorsExpanded={assistantsExpanded && customExpanded}
                  />
                ) : (
                  <div key={agent.id} className="chat-sidebar-row">
                    <button
                      type="button"
                      className="chat-sidebar-entry"
                      disabled={chatPending}
                      onClick={() => void navigation.open({ kind: "custom-agent", id: agent.id })}
                    >
                      <span className="chat-sidebar-artwork" aria-hidden="true">
                        <NavigationIcon name="app-custom-agents" />
                      </span>
                      <span className="chat-sidebar-label">{agent.name}</span>
                    </button>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
      <div className="sidebar-section">
        <div
          className="chat-page-heading sidebar-card-header"
          data-nav-active={
            tabs.active === "projects" || (tabs.active === "project" && !chatExpanded)
          }
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
              aria-controls="panel-projects"
              data-active={
                tabs.active === "projects" || (tabs.active === "project" && !chatExpanded)
              }
              onClick={() => onSelect("projects")}
              onKeyDown={(event) => navigate(event, "chat")}
            >
              {pageDefinitions.projects.icon && (
                <NavigationIcon name={pageDefinitions.projects.icon} />
              )}
              <span className="page-tab-label">{pageDefinitions.projects.label}</span>
            </button>
          </div>
        </div>
        <button
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
        </button>
        {cardToggle(
          "projects-card-toggle",
          "Projects",
          "chat-pages",
          chatExpanded,
          setChatExpanded,
          "chat",
        )}
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
              ancestorsExpanded={chatExpanded}
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
              ancestorsExpanded={chatExpanded}
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
      </div>
      <ProvidersSidebar
        menuScope={`${sidebarOpen}:${tabs.active}:${tabs.providerId ?? ""}`}
        sidebarOpen={sidebarOpen}
        setup={providerSetup}
        management={providerManagement}
        selectedId={tabs.active === "provider" ? tabs.providerId : undefined}
        active={tabs.active === "providers" || tabs.active === "provider"}
        expanded={providersExpanded}
        onExpanded={setProvidersExpanded}
        onHome={() => onSelect("providers")}
        onOpen={(id) => void navigation.open({ kind: "provider", id })}
        onKeyDown={(event) => navigate(event, "providers")}
        onNext={() => moveTo("apps")}
        onFirst={() => moveTo(visible[0])}
        onLast={() => moveTo(visible.at(-1))}
      />
      <div className="sidebar-section">
        <div
          className="sidebar-card-header"
          role="tablist"
          aria-label="Apps page"
          aria-orientation="vertical"
        >
          {page("apps", true)}
        </div>
        {cardToggle(
          "apps-card-toggle",
          "Apps",
          "app-pages",
          appsExpanded,
          (open) => setDisclosure("apps", open),
          "apps",
        )}
        {staticChildrenPanel("apps")}
      </div>
      <div className="page-tab-list sidebar-settings sidebar-section">
        <div
          className="sidebar-settings-heading sidebar-card-header"
          data-active={settingsActive && !settingsExpanded}
          data-nav-active={settingsActive && !settingsExpanded}
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
        {cardToggle(
          "settings-card-toggle",
          "Settings",
          "settings-pages",
          settingsExpanded,
          (open) => setDisclosure("settings", open),
          "settings",
        )}
        {staticChildrenPanel("settings")}
      </div>
    </Card>
  );
}
