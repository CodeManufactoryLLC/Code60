import { useEffect, useState } from "react";
import type { AppPagesProps } from "./app-page-props.js";
import { useDesktopVisibility } from "./desktop-visibility.js";
import { prepareFileNavigation } from "./file-navigation.js";
import { emptyFileTabs, type FileTabAction, updateFileTabs } from "./file-tabs.js";
import { useFiles } from "./files.js";
import { useProjectScope } from "./project-scope.js";
import { updateTabs } from "./tabs.js";
import { useTranscripts } from "./transcripts.js";

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
type WorkspaceProps = Pick<
  AppPagesProps,
  "api" | "state" | "tabs" | "splash" | "setTabs" | "setError" | "notify"
> & {
  setBusy(busy: boolean): void;
};
export function useProjectWorkspace({
  api,
  state,
  tabs,
  splash,
  setTabs,
  setError,
  notify,
  setBusy,
}: WorkspaceProps) {
  const snapshot = state?.snapshot;
  const database = snapshot?.database ?? null;
  const directory = snapshot?.directory;
  // Panel geometry/visibility is application layout, not project file state.
  const [explorerOpen, setExplorerOpen] = useState(false);
  const project = {
    ...useProjectScope(database, directory, state?.projectGeneration ?? 0),
    explorerOpen,
    setExplorerOpen,
  };
  const {
    scope,
    selected,
    setSelected,
    workerSelection,
    setWorkerSelection,
    setVisitedWorkers,
    setChatRequest,
    fileTabs,
    setFileTabs,
  } = project;
  const workspace = scope.workspace;
  const workerScope = workspace;
  const workerId =
    workerSelection?.workspace === workerScope &&
    snapshot?.runs.some(({ record }) => record.id === workerSelection.id)
      ? workerSelection.id
      : undefined;
  const selectWorker = (id: string | undefined) => {
    setWorkerSelection(id ? { workspace: workerScope, id } : undefined);
    if (id) setSelected(id);
    if (id)
      setVisitedWorkers((current) => ({
        workspace: workerScope,
        ids: [...new Set([...(current.workspace === workerScope ? current.ids : []), id])],
      }));
  };
  const openChat = (id: string, compose = false, eventIndex?: number) => {
    selectWorker(id);
    setTabs((current) => updateTabs(current, { type: "select", id: "chat" }));
    setChatRequest((current) => ({
      id,
      serial: (current?.serial ?? 0) + 1,
      compose,
      ...(eventIndex === undefined ? {} : { eventIndex }),
    }));
  };
  const currentFileTabs = fileTabs.workspace === workspace ? fileTabs : emptyFileTabs(workspace);
  const fileAction = (action: FileTabAction) =>
    setFileTabs((current) =>
      updateFileTabs(current.workspace === workspace ? current : emptyFileTabs(workspace), action),
    );
  const activeFileTab = currentFileTabs.entries.find((tab) => tab.id === currentFileTabs.active);
  const filesActive =
    !splash &&
    tabs.active === "chat" &&
    explorerOpen &&
    activeFileTab !== undefined &&
    (activeFileTab.kind === "explorer" || (activeFileTab.kind === "file" && !activeFileTab.source));
  const fileBrowser = useFiles(
    api,
    snapshot,
    filesActive,
    activeFileTab?.kind === "file" && !activeFileTab.source ? activeFileTab.path : null,
    scope.viewKey,
  );
  const transcripts = useTranscripts(
    api,
    scope.viewKey,
    !!directory && !splash,
    tabs.active === "chat"
      ? snapshot?.runs.filter(({ record }) => record.id === workerId)
      : snapshot?.runs,
    snapshot?.liveIds,
    state?.events,
  );
  useEffect(() => {
    if (!snapshot) return;
    if (!snapshot.runs.some((item) => item.record.id === selected)) {
      const live = snapshot.liveIds[0];
      setSelected(live ?? snapshot.runs.at(-1)?.record.id);
    }
  }, [snapshot, selected, setSelected]);

  const browseFiles = async () => {
    if (!snapshot) return;
    const current = scope.capture();
    setBusy(true);
    try {
      const latest = await prepareFileNavigation(api, snapshot);
      if (!latest || !current()) return;
      fileAction({ type: "browse" });
      setExplorerOpen(true);
      setTabs((current) => updateTabs(current, { type: "select", id: "chat" }));
    } catch (cause) {
      if (current()) notify(message(cause), "error");
    } finally {
      setBusy(false);
    }
  };

  // Sending a message from the chat resumes the run, so Resume only opens it ready to type.
  const resume = (id: string) => {
    setSelected(id);
    openChat(id, true);
  };
  const reviewSummaries = snapshot?.reviews ?? [];
  useEffect(() => {
    const latest = reviewSummaries.at(-1);
    if (!latest || scope.ensuredChangesReview.get(workspace) === latest.id) return;
    scope.ensuredChangesReview.set(workspace, latest.id);
    setFileTabs((current) =>
      updateFileTabs(current.workspace === workspace ? current : emptyFileTabs(workspace), {
        type: "ensure-changes",
      }),
    );
  }, [reviewSummaries, workspace, scope, setFileTabs]);
  useEffect(() => {
    if (splash || workerId) return;
    for (const plan of snapshot?.chat.plans ?? []) {
      if (plan.state !== "draft" || scope.openedPlans.get(plan.id) === plan.proposalRevision)
        continue;
      scope.openedPlans.set(plan.id, plan.proposalRevision);
      setFileTabs((current) =>
        updateFileTabs(current.workspace === workspace ? current : emptyFileTabs(workspace), {
          type: "plan",
          planId: plan.id,
          title: plan.title,
        }),
      );
      setExplorerOpen(true);
      setTabs((current) => updateTabs(current, { type: "select", id: "chat" }));
    }
  }, [snapshot?.chat.plans, splash, workerId, workspace, scope, setFileTabs, setTabs]);
  const openReview = (id: string) => {
    selectWorker(undefined);
    const review = snapshot?.reviews?.find((review) => review.id === id);
    const revision = review?.revisions.at(-1);
    fileAction(
      review && revision
        ? {
            type: "revision",
            reviewId: id,
            revisionId: revision.id,
            title: `Revision ${review.revisions.length} · ${review.title}`,
          }
        : { type: "changes" },
    );
    setExplorerOpen(true);
    setTabs((current) => updateTabs(current, { type: "select", id: "chat" }));
    const current = scope.capture();
    if (review?.chatId && snapshot?.chats.some((chat) => chat.run?.id === review.chatId))
      void api.orchestrationChatAction({ type: "select", id: review.chatId }).catch((cause) => {
        if (current()) setError(message(cause));
      });
  };
  const reviewRun = async (runId: string) => {
    if (!directory) return;
    const current = scope.capture();
    try {
      const id = await api.reviewAction({ type: "open-run", project: directory, runId });
      if (current()) openReview(id);
    } catch (cause) {
      if (current()) setError(message(cause));
    }
  };
  useDesktopVisibility(api, tabs.active, splash, filesActive, setError);
  return {
    project,
    workerId,
    fileBrowser,
    transcripts,
    selectWorker,
    openChat,
    fileAction,
    browseFiles,
    resume,
    openReview,
    reviewRun,
  };
}
