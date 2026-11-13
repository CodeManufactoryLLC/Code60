import { useEffect, useState } from "react";
import type { AppPagesProps } from "./app-page-props.js";
import { useDesktopVisibility } from "./desktop-visibility.js";
import { prepareFileNavigation, showsProjectFiles } from "./file-navigation.js";
import { emptyFileTabs, type FileTabAction, updateFileTabs } from "./file-tabs.js";
import { useFiles } from "./files.js";
import type { ChatNavigation } from "./history-navigation.js";
import { useProjectScope } from "./project-scope.js";
import { updateTabs } from "./tabs.js";
import { useTranscripts } from "./transcripts.js";

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
type WorkspaceProps = Pick<
  AppPagesProps,
  "api" | "state" | "tabs" | "splash" | "setTabs" | "setError" | "notify"
> & {
  setBusy(busy: boolean): void;
  onWorkerSelection(id: string | undefined): void;
  /** Lets navigation history wait for orchestrator selection made by a review. */
  onChatNavigation?: ChatNavigation;
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
  onWorkerSelection,
  onChatNavigation,
}: WorkspaceProps) {
  const snapshot = state?.snapshot;
  const database = snapshot?.database ?? null;
  const directory = snapshot?.directory;
  // Panel geometry/visibility is application layout, not project file state.
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [relayWorkerSelection, setRelayWorkerSelection] = useState<string>();
  const [visitedRelayWorkers, setVisitedRelayWorkers] = useState<string[]>([]);
  const [requestedProjectWorker, setRequestedProjectWorker] = useState<string>();
  const [explicitFileScope, setExplicitFileScope] = useState<string>();
  const project = {
    ...useProjectScope(
      database,
      directory,
      state?.projectGeneration ?? 0,
      snapshot?.openProjects
        ? {
            id: snapshot.projectInstanceId ?? null,
            openIds: snapshot.openProjects.map((project) => project.id),
            databaseEpoch: snapshot.databaseEpoch ?? 0,
          }
        : undefined,
    ),
    explorerOpen,
    setExplorerOpen,
    visitedRelayWorkers,
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
    relayWorkerSelection &&
    snapshot?.runs.some((run) => run.relay && run.record.id === relayWorkerSelection)
      ? relayWorkerSelection
      : workerSelection?.workspace === workerScope &&
          snapshot?.runs.some(({ record }) => record.id === workerSelection.id)
        ? workerSelection.id
        : undefined;
  useEffect(() => onWorkerSelection(workerId), [onWorkerSelection, workerId]);
  const selectWorker = (id: string | undefined, projectId?: string | null) => {
    setExplicitFileScope(undefined);
    setRequestedProjectWorker(undefined);
    if (id === undefined && projectId !== undefined) {
      setRelayWorkerSelection(undefined);
      if (projectId === null) setWorkerSelection(undefined);
      const owner = snapshot?.openProjects?.find((owner) => owner.id === projectId);
      if (owner)
        project.retainedScopes
          .find((retained) => retained.project === owner.path)
          ?.set("workerSelection", undefined);
      return;
    }
    const owner = id
      ? snapshot?.openProjects?.find((owner) => owner.workerIds.includes(id))
      : undefined;
    if (owner && owner.id !== snapshot?.projectInstanceId) {
      const current = scope.capture();
      void api
        .projectAction({ type: "select", projectId: owner.id })
        .then(() => {
          if (current()) setRequestedProjectWorker(id);
        })
        .catch((cause) => {
          if (current()) setError(message(cause));
        });
      return;
    }
    if (id && snapshot?.runs.some((run) => run.relay && run.record.id === id)) {
      setRelayWorkerSelection(id);
      setVisitedRelayWorkers((current) => (current.includes(id) ? current : [...current, id]));
      return;
    }
    setRelayWorkerSelection(undefined);
    setWorkerSelection(id ? { workspace: workerScope, id } : undefined);
    if (id) setSelected(id);
    if (id)
      setVisitedWorkers((current) => ({
        workspace: workerScope,
        ids: [...new Set([...(current.workspace === workerScope ? current.ids : []), id])],
      }));
  };
  useEffect(() => {
    if (!requestedProjectWorker || !snapshot) return;
    const owner = snapshot.openProjects?.find((owner) =>
      owner.workerIds.includes(requestedProjectWorker),
    );
    if (!owner) {
      setRequestedProjectWorker(undefined);
      return;
    }
    if (owner.id !== snapshot.projectInstanceId) return;
    setRelayWorkerSelection(undefined);
    setWorkerSelection({ workspace: workerScope, id: requestedProjectWorker });
    setSelected(requestedProjectWorker);
    setVisitedWorkers((current) => ({
      workspace: workerScope,
      ids: [...new Set([...current.ids, requestedProjectWorker])],
    }));
    setRequestedProjectWorker(undefined);
  }, [
    requestedProjectWorker,
    snapshot,
    workerScope,
    setWorkerSelection,
    setVisitedWorkers,
    setSelected,
  ]);
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
  const fileAction = (action: FileTabAction) => {
    if (directory && ["browse", "file", "explorer", "revision", "changes"].includes(action.type))
      setExplicitFileScope(scope.viewKey);
    setFileTabs((current) =>
      updateFileTabs(current.workspace === workspace ? current : emptyFileTabs(workspace), action),
    );
  };
  const explicitProjectFiles = explicitFileScope === scope.viewKey;
  const activeFileTab = currentFileTabs.entries.find((tab) => tab.id === currentFileTabs.active);
  const filesActive =
    (showsProjectFiles(snapshot, workerId) || explicitProjectFiles) &&
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
    snapshot?.openProjects ? scope.files() : undefined,
  );
  const relayIds = new Set(snapshot?.runs.filter((run) => run.relay).map((run) => run.record.id));
  const projectTranscripts = useTranscripts(
    api,
    scope.viewKey,
    !!directory && !splash,
    tabs.active === "chat"
      ? snapshot?.runs.filter((run) => !run.relay && run.record.id === workerId)
      : snapshot?.runs.filter((run) => !run.relay),
    snapshot?.liveIds.filter((id) => !relayIds.has(id)),
    Object.fromEntries(Object.entries(state?.events ?? {}).filter(([id]) => !relayIds.has(id))),
    snapshot?.openProjects ? scope.transcripts(api) : undefined,
  );
  const relayTranscripts = useTranscripts(
    api,
    "relay-workers",
    !splash,
    snapshot?.runs.filter(
      (run) => run.relay && (tabs.active !== "chat" || run.record.id === workerId),
    ),
    snapshot?.liveIds.filter((id) => relayIds.has(id)),
    Object.fromEntries(Object.entries(state?.events ?? {}).filter(([id]) => relayIds.has(id))),
  );
  const transcripts = {
    ...projectTranscripts,
    events: { ...projectTranscripts.events, ...relayTranscripts.events },
    errors: { ...projectTranscripts.errors, ...relayTranscripts.errors },
    pending: projectTranscripts.pending + relayTranscripts.pending,
    read: async () => ({
      ...(await projectTranscripts.read()),
      ...(await relayTranscripts.read()),
    }),
    retry: () => {
      projectTranscripts.retry();
      relayTranscripts.retry();
    },
  };
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
    if (splash || workerId || snapshot?.chat.kind === "relay") return;
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
  }, [
    snapshot?.chat.plans,
    snapshot?.chat.kind,
    splash,
    workerId,
    workspace,
    scope,
    setFileTabs,
    setTabs,
  ]);
  const openReview = (id: string) => {
    const review = snapshot?.reviews?.find((review) => review.id === id);
    const chatId = review?.chatId;
    const switchChat = chatId && snapshot?.chats.some((chat) => chat.run?.id === chatId);
    const navigation = switchChat ? onChatNavigation?.({ type: "select", id: chatId }) : undefined;
    selectWorker(undefined);
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
    if (switchChat)
      void api.orchestrationChatAction({ type: "select", id: chatId }).then(
        () => navigation?.[0](true),
        (cause) => {
          navigation?.[0](false);
          if (current()) setError(message(cause));
        },
      );
  };
  const reviewRun = async (runId: string) => {
    if (!directory) return;
    const current = scope.capture();
    try {
      const id = await api.reviewAction({
        type: "open-run",
        project: directory,
        runId,
        ...(snapshot?.projectInstanceId
          ? {
              projectId: snapshot.projectInstanceId,
              databaseEpoch: snapshot.databaseEpoch,
            }
          : {}),
      });
      if (current()) openReview(id);
    } catch (cause) {
      if (current()) setError(message(cause));
    }
  };
  useDesktopVisibility(api, tabs.active, splash, filesActive, setError);
  return {
    project: { ...project, explicitProjectFiles },
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
