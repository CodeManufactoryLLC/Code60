import { type KeyboardEvent, useEffect, useLayoutEffect, useState } from "react";
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
}: {
  tabs: PageTabs;
  /** The open project folder, if any. */
  directory?: string | undefined;
  onSelect(id: PageId): void;
  onOpenProject(): void;
  projectDisabled: boolean;
}) {
  const repository = directory ? pathLabel(directory) : directory;
  return (
    <nav className="sidebar" aria-label="Sidebar">
      <button
        type="button"
        className="sidebar-header project-card"
        data-empty={!directory}
        disabled={projectDisabled}
        onClick={onOpenProject}
        aria-haspopup="dialog"
        title={directory}
      >
        <Icon name="folder" />
        <span className="sidebar-title">{repository ?? "Open a project"}</span>
      </button>
      <PageTabList tabs={tabs} onSelect={onSelect} />
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

function PageTabList({ tabs, onSelect }: { tabs: PageTabs; onSelect(id: PageId): void }) {
  const [experimentsExpanded, setExperimentsExpanded] = useState(
    () => localStorage.getItem("code60.experimentsExpanded") === "true",
  );
  const [expanded, setExpanded] = useState(
    () => localStorage.getItem("code60.tablesExpanded") === "true",
  );
  const experimentActive = experimentPages.includes(tabs.active);
  const tableActive = tablePages.includes(tabs.active);
  useLayoutEffect(() => {
    if (tablePages.includes(tabs.active)) setExpanded(true);
    else if (experimentPages.includes(tabs.active)) setExperimentsExpanded(true);
    else return;
    // Expansion and modal focus restoration must finish before focusing the revealed page.
    const frame = requestAnimationFrame(() =>
      document.getElementById(`tab-${tabs.active}`)?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [tabs]);
  useEffect(() => {
    localStorage.setItem("code60.tablesExpanded", String(expanded));
  }, [expanded]);
  useEffect(() => {
    localStorage.setItem("code60.experimentsExpanded", String(experimentsExpanded));
  }, [experimentsExpanded]);
  const pages = [...tabs.open].sort((a, b) => labels[a].localeCompare(labels[b]));
  const primary = pages.filter((id) => pageGroup(id) === "primary");
  const experiments = pages.filter((id) => experimentPages.includes(id));
  const tables = pages.filter((id) => tablePages.includes(id));
  const beforeExperiments = primary.filter((id) => labels[id].localeCompare("Experiments") < 0);
  const afterExperiments = primary.filter((id) => labels[id].localeCompare("Experiments") > 0);
  const visible: (PageId | "tables" | "experiments")[] = [
    ...beforeExperiments,
    "experiments",
    ...(experimentsExpanded ? experiments : []),
    ...afterExperiments,
    "tables",
    ...(expanded ? tables : []),
  ];
  function navigate(event: KeyboardEvent<HTMLButtonElement>, id: (typeof visible)[number]) {
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
    if (target === "tables" || target === "experiments")
      document.getElementById(`${target}-toggle`)?.focus();
    else if (target) onSelect(target);
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
      <div className="page-tab-list" role="tablist" aria-label="Pages" aria-orientation="vertical">
        {beforeExperiments.map((id) => page(id, id === primary[0]))}
      </div>
      <div className="page-tab">
        <button
          type="button"
          id="experiments-toggle"
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
          className="page-group-toggle"
          aria-expanded={expanded}
          aria-controls="table-pages"
          data-active={tableActive && !expanded}
          onClick={() => setExpanded((value) => !value)}
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
