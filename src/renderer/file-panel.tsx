import { useEffect, useMemo, useRef, useState } from "react";
import type { DesktopApi, PlanSummary, ReviewSummary } from "../bridge/index.js";
import { type FileTabAction, type FileTabs, fileTabLabel, updateFileTabs } from "./file-tabs.js";
import { type FileBrowser, FileInspector, FilesPage } from "./files.js";
import type { PreviewViewState } from "./monaco-preview.js";
import { PanelShell } from "./panel-shell.js";
import { PlanPanelLoader } from "./plan-panel.js";
import { ReviewFilePreview } from "./review-content.js";
import { ReviewPanelLoader } from "./review-panel.js";

export function FilePanel({
  tabs,
  onAction,
  browser,
  open,
  active,
  onOpenProject,
  onToggle,
  api,
  reviews = [],
  plans = [],
  project = "",
  currentChat,
  chatIds = [],
  unisolated = [],
  onSetupGit,
}: {
  tabs: FileTabs;
  onAction(action: FileTabAction): void;
  browser: FileBrowser;
  open: boolean;
  active: boolean;
  onOpenProject(): void;
  onToggle(): void;
  api?: DesktopApi;
  reviews?: ReviewSummary[];
  plans?: PlanSummary[];
  project?: string;
  currentChat?: string | undefined;
  chatIds?: string[];
  unisolated?: string[];
  onSetupGit?: (() => void) | undefined;
}) {
  const [hiddenFiles, setHiddenFiles] = useState(false);
  const views = useRef(new Map<number, { current: PreviewViewState | null }>());
  const selected = tabs.entries.find((tab) => tab.id === tabs.active);
  if (selected?.kind === "file" && !views.current.has(selected.id))
    views.current.set(selected.id, { current: null });
  useEffect(() => {
    for (const id of views.current.keys()) {
      if (!tabs.entries.some((tab) => tab.id === id)) views.current.delete(id);
    }
  }, [tabs.entries]);
  const panelTabs = useMemo(
    () =>
      tabs.entries.map((tab) => ({
        id: tab.id,
        label: fileTabLabel(tab, tabs.entries),
        title: tab.kind === "file" ? tab.path : fileTabLabel(tab, tabs.entries),
        icon:
          tab.kind === "changes"
            ? ("compare" as const)
            : tab.kind === "explorer"
              ? ("folder" as const)
              : ("document" as const),
      })),
    [tabs.entries],
  );
  const act = (action: FileTabAction) => {
    const next = updateFileTabs(tabs, action);
    onAction(action);
    return next.active;
  };
  return (
    <PanelShell
      id="chat-file-panel"
      name="Files"
      emptyLabel="Open files"
      tabs={panelTabs}
      selectedId={tabs.active}
      onAction={(action) => act(action.type === "add" ? { type: "blank" } : action)}
      open={open}
      active={active}
      onToggle={onToggle}
    >
      {(focusActiveTab) =>
        !selected || selected.kind === "blank" ? (
          <div className="file-panel-empty">
            <button
              type="button"
              className="file-open-link"
              onClick={() => {
                focusActiveTab();
                act({ type: "explorer" });
              }}
            >
              Open Files
            </button>
          </div>
        ) : selected.kind === "plan" ? (
          api && active && open && plans.some((plan) => plan.id === selected.planId) ? (
            <PlanPanelLoader
              key={selected.planId}
              api={api}
              summary={plans.find((plan) => plan.id === selected.planId) as PlanSummary}
              currentChat={currentChat}
              project={project || null}
            />
          ) : (
            <p role="status">Plan conversation unavailable.</p>
          )
        ) : selected.kind === "changes" ? (
          api && active && open && reviews.find((review) => review.id === selected.reviewId) ? (
            <ReviewPanelLoader
              key={`${selected.reviewId}:${selected.visit}`}
              api={api}
              project={project}
              review={reviews.find((review) => review.id === selected.reviewId) as ReviewSummary}
              currentChat={currentChat}
              chatIds={chatIds}
              unisolated={unisolated}
              onSetupGit={onSetupGit}
              onBrowseProject={() => act({ type: "browse" })}
              onOpenFile={(path, source) => {
                focusActiveTab();
                act({ type: "file", path, source });
              }}
            />
          ) : null
        ) : selected.kind === "explorer" ? (
          <FilesPage
            key={selected.id}
            browser={browser}
            onOpenProject={onOpenProject}
            active={active && open}
            hidden={hiddenFiles}
            onHidden={setHiddenFiles}
            onOpenFile={(path) => {
              focusActiveTab();
              browser.selectFile(path);
              act({ type: "file", path });
            }}
          />
        ) : active && open && selected.kind === "file" && selected.source && api ? (
          <ReviewFilePreview
            key={selected.id}
            api={api}
            project={project}
            address={selected.source}
            viewState={views.current.get(selected.id)}
          />
        ) : active && open ? (
          <FileInspector
            key={selected.id}
            browser={browser}
            viewState={views.current.get(selected.id)}
          />
        ) : null
      }
    </PanelShell>
  );
}
