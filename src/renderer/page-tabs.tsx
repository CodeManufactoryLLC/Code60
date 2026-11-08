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
  chat: "chat",
  "episodic-memory": "document",
  files: "document",
  configurations: "grid",
  messages: "grid",
  events: "grid",
  polling: "grid",
  prompts: "document",
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
          data-empty={!directory}
          disabled={projectDisabled}
          onClick={onOpenProject}
          aria-haspopup="dialog"
          title={directory ?? "Open a project"}
        >
          <Icon name="folder" />
          <span className="sidebar-title">{repository ?? "Open a project"}</span>
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
const pageGroup = (id: PageId) =>
  tablePages.includes(id) ? "tables" : experimentPages.includes(id) ? "experiments" : "primary";

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
    if (chatInFlight.current) return;
    chatInFlight.current = true;
    setChatPending(true);
    setChatError("");
    onSelect("chat");
    try {
      await api.orchestrationChatAction(request);
      onWorkerSelect(undefined);
    } catch (cause) {
      setChatError(cause instanceof Error ? cause.message : String(cause));
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
  const [experimentsExpanded, setExperimentsExpanded] = useState(
    () => localStorage.getItem("code60.experimentsExpanded") === "true",
  );
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem("code60.tablesExpanded") === "true",
  );
  const navigationFrame = useRef<number | undefined>(undefined);
  const experimentActive = experimentPages.includes(tabs.active);
  const tableActive = tablePages.includes(tabs.active);
  useLayoutEffect(() => {
    if (tablePages.includes(tabs.active)) setExpanded(true);
    else if (experimentPages.includes(tabs.active)) setExperimentsExpanded(true);
    else return;
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
    localStorage.setItem("code60.experimentsExpanded", String(experimentsExpanded));
  }, [experimentsExpanded]);
  const pages = [...tabs.open].sort((a, b) => labels[a].localeCompare(labels[b]));
  const primary = pages.filter(
    (id) => pageGroup(id) === "primary" && id !== "chat" && id !== "files",
  );
  const experiments = pages.filter((id) => experimentPages.includes(id));
  const tables = pages.filter((id) => tablePages.includes(id));
  const beforeExperiments = primary.filter((id) => labels[id].localeCompare("Experiments") < 0);
  const afterExperiments = primary.filter((id) => labels[id].localeCompare("Experiments") > 0);
  const visible: (PageId | "tables" | "experiments")[] = [
    "chat",
    ...beforeExperiments,
    "experiments",
    ...(experimentsExpanded ? experiments : []),
    ...afterExperiments,
    "tables",
    ...(expanded ? tables : []),
  ];
  function navigate(event: KeyboardEvent<HTMLButtonElement>, id: (typeof visible)[number]) {
    // A delayed reveal must not undo a subsequent keyboard navigation.
    if (navigationFrame.current !== undefined) {
      cancelAnimationFrame(navigationFrame.current);
      navigationFrame.current = undefined;
    }
    if (id === "experiments" && event.key === "ArrowUp" && chatExpanded) {
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
    if (
      event.key === "ArrowLeft" &&
      (id === "experiments" || experimentPages.some((pageId) => pageId === id))
    ) {
      event.preventDefault();
      setExperimentsExpanded(false);
      document.getElementById("experiments-toggle")?.focus();
      return;
    }
    if (event.key === "ArrowRight" && id === "experiments") {
      event.preventDefault();
      if (experimentsExpanded && experiments[0]) onSelect(experiments[0]);
      else setExperimentsExpanded(true);
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
    const target = visible[next];
    if (target === "chat") {
      onSelect("chat");
      document.getElementById("tab-chat")?.focus();
    } else if (target === "tables" || target === "experiments")
      document.getElementById(`${target}-toggle`)?.focus();
    else if (target) {
      onSelect(target);
      document.getElementById(`tab-${target}`)?.focus();
    }
  }
  function page(id: PageId, first: boolean) {
    return (
      <div className="page-tab" role="presentation" key={id}>
        <button
          type="button"
          role="tab"
          id={`tab-${id}`}
          aria-controls={`panel-${id}`}
          aria-selected={tabs.active === id}
          title={labels[id]}
          tabIndex={
            tabs.active === id || (first && pageGroup(tabs.active) !== pageGroup(id)) ? 0 : -1
          }
          onClick={() => onSelect(id)}
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
      <div className="chat-page-heading">
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
            data-active={tabs.active === "chat"}
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
              onSelect("chat");
              document.getElementById("tab-chat")?.focus();
              return;
            }
            if (event.key === "End") {
              const last = visible[visible.length - 1];
              if (last === "tables" || last === "experiments")
                document.getElementById(`${last}-toggle`)?.focus();
              else if (last) onSelect(last);
              return;
            }
            const next = index + (event.key === "ArrowDown" ? 1 : -1);
            if (next >= buttons.length) document.getElementById("experiments-toggle")?.focus();
            else buttons[next]?.focus();
          }
        }}
      >
        <ChatSidebar
          chats={chats}
          runs={runs}
          selectedId={selectedId}
          navigationSerial={navigationSerial}
          database={database}
          eventsByRun={eventsByRun}
          open={tabs.active === "chat"}
          pending={chatPending}
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
        {beforeExperiments.map((id) => page(id, id === primary[0]))}
      </div>
      <div className="page-tab">
        <button
          type="button"
          id="experiments-toggle"
          title="Experiments"
          className="page-group-toggle"
          aria-expanded={experimentsExpanded}
          aria-controls="experiment-pages"
          data-active={experimentActive && !experimentsExpanded}
          onClick={() => {
            setExperimentsExpanded((value) => !value);
          }}
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
        aria-orientation="vertical"
        className="page-tab-list page-group-pages"
        aria-label="Experiments"
        hidden={!experimentsExpanded}
      >
        {experiments.map((id, index) => page(id, index === 0))}
      </div>
      <div
        className="page-tab-list"
        role="tablist"
        aria-label="More pages"
        aria-orientation="vertical"
      >
        {afterExperiments.map((id) => page(id, id === primary[0]))}
      </div>
      <div className="page-tab">
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
    </div>
  );
}
