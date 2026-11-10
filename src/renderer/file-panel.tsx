import { useEffect, useMemo, useRef, useState } from "react";
import type { DesktopApi, PlanSummary, ReviewSummary } from "../bridge/index.js";
import { type FileTabAction, type FileTabs, fileTabLabel, updateFileTabs } from "./file-tabs.js";
import { type FileBrowser, FileInspector, FilesPage } from "./files.js";
import { Icon } from "./icons.js";
import type { PreviewViewState } from "./monaco-preview.js";
import { PanelShell } from "./panel-shell.js";
import { PlanPanelLoader } from "./plan-panel.js";
import { ReviewFilePreview } from "./review-content.js";
import { ReviewPanelLoader } from "./review-panel.js";

function revisionTime(at: string, now = new Date()): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return date.toDateString() === now.toDateString()
    ? time
    : `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

export function RevisionList({
  reviews,
  open = new Set(),
  onOpen,
}: {
  reviews: ReviewSummary[];
  open?: ReadonlySet<string>;
  onOpen(action: Extract<FileTabAction, { type: "revision" }>): void;
}) {
  if (reviews.length === 0) return <p className="file-panel-empty">No changes yet.</p>;
  return (
    <nav className="revision-list" aria-label="Task revisions">
      {reviews.map((review) => (
        <section key={review.id} aria-label={review.title}>
          <h3 className="revision-task" title={review.title}>
            <Icon name="task--tools" />
            <span>{review.title}</span>
            <span className="revision-count" aria-hidden="true">
              {review.revisions.length}
            </span>
          </h3>
          <ul>
            {review.revisions.map((revision, index) => (
              <li key={revision.id}>
                <button
                  type="button"
                  className="revision-item"
                  title={new Date(revision.at).toLocaleString()}
                  data-open={open.has(`${review.id}:${revision.id}`) || undefined}
                  onClick={() =>
                    onOpen({
                      type: "revision",
                      reviewId: review.id,
                      revisionId: revision.id,
                      title: `Revision ${index + 1} · ${review.title}`,
                    })
                  }
                >
                  <Icon name="file--diff" />
                  <span>Revision {index + 1}</span>
                  {index === review.revisions.length - 1 && (
                    <span className="revision-latest">Latest</span>
                  )}
                  {open.has(`${review.id}:${revision.id}`) && (
                    <span className="sr-only">(open)</span>
                  )}
                  <time dateTime={revision.at}>{revisionTime(revision.at)}</time>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

export function FilePanel({
  tabs,
  onAction,
  browser,
  open,
  active,
  onOpenProject,
  onToggle,
  disabled = false,
  api,
  reviews = [],
  plans = [],
  project = "",
  currentChat,
}: {
  tabs: FileTabs;
  onAction(action: FileTabAction): void;
  browser: FileBrowser;
  open: boolean;
  active: boolean;
  onOpenProject(): void;
  onToggle(): void;
  disabled?: boolean;
  api?: DesktopApi;
  reviews?: ReviewSummary[];
  plans?: PlanSummary[];
  project?: string;
  currentChat?: string | undefined;
}) {
  const [hiddenFiles, setHiddenFiles] = useState(false);
  const views = useRef(new Map<number, { current: PreviewViewState | null }>());
  const selected = tabs.entries.find((tab) => tab.id === tabs.active);
  const selectedReview =
    selected?.kind === "revision"
      ? reviews.find((review) => review.id === selected.reviewId)
      : undefined;
  const openRevisions = useMemo(
    () =>
      new Set(
        tabs.entries.flatMap((tab) =>
          tab.kind === "revision" ? [`${tab.reviewId}:${tab.revisionId}`] : [],
        ),
      ),
    [tabs.entries],
  );
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
            ? ("task--tools" as const)
            : tab.kind === "explorer"
              ? ("folder" as const)
              : tab.kind === "revision"
                ? ("file--diff" as const)
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
      disabled={disabled}
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
        disabled ? (
          <p className="file-panel-empty">Connect a database to use files.</p>
        ) : !selected || selected.kind === "blank" ? (
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
          <RevisionList
            reviews={reviews}
            open={openRevisions}
            onOpen={(action) => {
              focusActiveTab();
              act(action);
            }}
          />
        ) : selected.kind === "revision" ? (
          api && active && open && selectedReview ? (
            <ReviewPanelLoader
              key={`${selected.reviewId}:${selected.revisionId}`}
              api={api}
              project={project}
              review={selectedReview}
              revisionId={selected.revisionId}
            />
          ) : selectedReview ? null : (
            <p role="status">Revision unavailable.</p>
          )
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
