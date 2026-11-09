import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  DesktopApi,
  DesktopRun,
  OrchestrationChat,
  OrchestrationChatAction,
} from "../bridge/index.js";
import type { RunEvent } from "../core/index.js";
import { ChatSidebar } from "./chat-sidebar.js";
import { Icon, type IconName } from "./icons.js";
import { pathLabel } from "./path-label.js";
import type { PageId, PageTabs } from "./tabs.js";

const labels: Record<PageId, string> = {
  "contributor-tools": "Contributor Tools",
  chat: "Chat",
  "episodic-memory": "Episodic Memory",
  files: "Files",
  sessions: "Sessions",
  messages: "Messages",
  events: "Events",
  search: "Search",
  configurations: "Configurations",
  worktrees: "Worktrees",
  polling: "Polling",
  prompts: "Prompt Editor",
  settings: "Settings",
};

const pageIcons: Record<PageId, IconName> = {
  "contributor-tools": "settings",
  chat: "chat",
  "episodic-memory": "document",
  files: "document",
  configurations: "grid",
  messages: "grid",
  events: "grid",
  polling: "grid",
  prompts: "prompt-template",
  search: "search",
  sessions: "grid",
  settings: "settings",
  worktrees: "grid",
};

export function PageTabBar({
  tabs,
  directory,
  onSelect,
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
}: {
  tabs: PageTabs;
  /** The open project folder, if any. */
  directory?: string | undefined;
  onSelect(id: PageId): void;
  onOpenProject(): void;
  onConnectDatabase?(): void;
  projectDisabled: boolean;
  api: DesktopApi;
  chats: readonly OrchestrationChat[];
  runs: readonly DesktopRun[];
  onWorkerSelect(id: string | undefined): void;
  selectedId: string | undefined;
  navigationSerial: number | undefined;
  database: string | null;
  eventsByRun: Readonly<Record<string, readonly RunEvent[]>>;
}) {
  const repository = directory ? pathLabel(directory) : directory;
  const sidebar = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem("code60.sidebarWidth"));
    return Number.isFinite(saved) && saved >= 180 && saved <= 480 ? saved : 220;
  });
  useLayoutEffect(() => {
    sidebar.current?.parentElement?.style.setProperty("--sidebar-width", `${width}px`);
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
          title={!database ? "Connect to database" : (directory ?? "Open a project")}
        >
          <Icon name="folder" />
          <span className="sidebar-title">
            {!database ? "Connect to database" : (repository ?? "Open a project")}
          </span>
        </button>
        <PageTabList
          tabs={tabs}
          onSelect={onSelect}
          api={api}
          chats={chats}
          runs={runs}
          onWorkerSelect={onWorkerSelect}
          selectedId={selectedId}
          navigationSerial={navigationSerial}
          database={database}
          eventsByRun={eventsByRun}
        />
      </div>
    </nav>
  );
}

const tablePages: readonly PageId[] = [
  "configurations",
  "events",
  "messages",
  "polling",
  "sessions",
  "worktrees",
];

const experimentPages: readonly PageId[] = ["episodic-memory"];
const pageGroup = (id: PageId) => {
  if (tablePages.includes(id)) return "tables";
  if (experimentPages.includes(id) || id === "contributor-tools") return "advanced";
  if (id === "chat" || id === "settings") return id;
  return "primary";
};

function PageTabList({
  tabs,
  onSelect,
  api,
  chats,
  runs,
  onWorkerSelect,
  selectedId,
  navigationSerial,
  database,
  eventsByRun,
}: {
  tabs: PageTabs;
  onSelect(id: PageId): void;
  api: DesktopApi;
  chats: readonly OrchestrationChat[];
  runs: readonly DesktopRun[];
  onWorkerSelect(id: string | undefined): void;
  selectedId: string | undefined;
  navigationSerial: number | undefined;
  database: string | null;
  eventsByRun: Readonly<Record<string, readonly RunEvent[]>>;
}) {
  const [chatPending, setChatPending] = useState(false);
  const [chatError, setChatError] = useState("");
  const chatInFlight = useRef(false);
  async function chatAction(request: OrchestrationChatAction) {
    if (!database || chatInFlight.current) return false;
    chatInFlight.current = true;
    setChatPending(true);
    setChatError("");
    const navigate = request.type === "new" || request.type === "select";
    if (navigate) onSelect("chat");
    try {
      await api.orchestrationChatAction(request);
      if (navigate) onWorkerSelect(undefined);
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
    if (activeChanged && (tabs.active === "settings" || pageGroup(tabs.active) === "advanced")) {
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
  const pages = [...tabs.open].sort((a, b) => labels[a].localeCompare(labels[b]));
  const primary = pages.filter((id) => pageGroup(id) === "primary" && id !== "files");
  const experiments = pages.filter((id) => experimentPages.includes(id));
  const tables = pages.filter((id) => tablePages.includes(id));
  const destinations: (PageId | "tables" | "advanced" | "experiments")[] = [
    "chat",
    ...primary,
    "tables",
    ...(expanded ? tables : []),
    "settings",
    ...(settingsExpanded
      ? ([
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
    (id) => database || ["chat", "settings", "advanced", "contributor-tools"].includes(id),
  );
  function moveTo(target: (typeof visible)[number] | undefined) {
    if (target === "tables" || target === "advanced" || target === "experiments") {
      document.getElementById(`${target}-toggle`)?.focus();
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
      if (settingsExpanded) moveTo("advanced");
      else setSettingsExpanded(true);
      return;
    }
    if (id === "advanced" && event.key === "ArrowUp") {
      event.preventDefault();
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
          aria-selected={tabs.active === id}
          title={labels[id]}
          disabled={!database && id !== "settings" && id !== "contributor-tools"}
          tabIndex={
            tabs.active === id || (first && pageGroup(tabs.active) !== pageGroup(id)) ? 0 : -1
          }
          onClick={() => {
            if (id === "settings" && tabs.active === "settings")
              setSettingsExpanded((value) => !value);
            onSelect(id);
          }}
          onKeyDown={(event) => navigate(event, id)}
        >
          <Icon name={pageIcons[id]} />
          <span className="page-tab-label">{labels[id]}</span>
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
            <Icon name="chat" />
            <span className="page-tab-label">Chat</span>
            <Icon name={chatExpanded ? "chevron--down" : "chevron--right"} />
          </button>
        </div>
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
        <ChatSidebar
          onAction={chatAction}
          chats={chats}
          runs={runs}
          selectedId={selectedId}
          navigationSerial={navigationSerial}
          database={database}
          eventsByRun={eventsByRun}
          open={tabs.active === "chat"}
          pending={chatPending || !database}
          onSelect={(id) => {
            if (chats.some((chat) => chat.run?.id === id)) void chatAction({ type: "select", id });
            else {
              onWorkerSelect(id);
              onSelect("chat");
            }
          }}
        />
      </div>
      <div className="page-tab-list" role="tablist" aria-label="Pages" aria-orientation="vertical">
        {primary.map((id, index) => page(id, index === 0))}
      </div>
      <div className="page-tab" data-nav-active={tableActive && !expanded}>
        <button
          type="button"
          id="tables-toggle"
          title="Tables"
          disabled={!database}
          className="page-group-toggle"
          aria-expanded={expanded}
          aria-controls="table-pages"
          data-active={tableActive && !expanded}
          onClick={() => {
            setExpanded((value) => !value);
          }}
          onKeyDown={(event) => navigate(event, "tables")}
        >
          <Icon name="grid" />
          <span className="page-tab-label">Tables</span>
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
      >
        {tables.map((id, index) => page(id, index === 0))}
      </div>
      <div className="page-tab-list sidebar-settings">
        <div
          className="sidebar-settings-heading"
          data-active={tabs.active === "settings" || (advancedActive && !settingsExpanded)}
          data-nav-active={tabs.active === "settings" || (advancedActive && !settingsExpanded)}
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
        >
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
              <Icon name="compare" />
              <span className="page-tab-label">Advanced</span>
              <Icon name={advancedExpanded ? "chevron--down" : "chevron--right"} />
            </button>
          </div>
          <div
            id="advanced-pages"
            className="page-tab-list page-group-pages"
            hidden={!advancedExpanded}
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
                <Icon name="compare" />
                <span className="page-tab-label">Experiments</span>
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
