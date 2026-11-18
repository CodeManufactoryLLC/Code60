import { useState } from "react";
import type { AppPagesProps } from "./app-page-props.js";
import { chatDraftKey } from "./chat-draft.js";
import { ChatPage } from "./chat-page.js";
import { conversationTitle, isSelectedConversation, workerLabel } from "./chats.js";
import { showsProjectFiles } from "./file-navigation.js";
import { FilePanel } from "./file-panel.js";
import { GitReadinessNotice, GitSetupDialog } from "./git-setup.js";
import { selectedRecallSource } from "./memory-recall-source.js";
import { RelayPlansPanel } from "./relay-plans-panel.js";
import { RetainedProjectPanels } from "./retained-project-panels.js";
import type { ReviewPreview } from "./review-actions.js";
import { WorkerChat } from "./worker-chat.js";

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
type ChatWorkspaceProps = Pick<
  AppPagesProps,
  | "api"
  | "state"
  | "project"
  | "tabs"
  | "splash"
  | "workerId"
  | "fileBrowser"
  | "transcripts"
  | "openReview"
  | "showPicker"
  | "notify"
  | "fileAction"
  | "setError"
  | "navigation"
>;
export function ChatWorkspace({
  api,
  state,
  project,
  tabs,
  splash,
  workerId,
  fileBrowser,
  transcripts,
  openReview,
  showPicker,
  notify,
  fileAction,
  setError,
  navigation,
}: ChatWorkspaceProps) {
  const snapshot = state?.snapshot;
  const conversationActive =
    tabs.active === "chat" && !navigation.projectPending && !navigation.conversationPending;
  const [panelOpen, setPanelOpen] = useState<Record<string, boolean>>({});
  const panelKey =
    snapshot?.runs.find((run) => run.record.id === workerId)?.relay?.conversationId ??
    snapshot?.chat.conversationId ??
    "";
  const relayPanelOpen = panelOpen[panelKey] ?? false;
  const [revisionPreview, setRevisionPreview] = useState<{ id: number; preview: ReviewPreview }>();
  const {
    scope,
    gitSetupProject,
    setGitSetupProject,
    chatRequest,
    fileTabs: currentFileTabs,
    explorerOpen,
    setExplorerOpen,
  } = project;
  const database = scope.database;
  const directory = scope.project;
  const workerViews = [
    ...project.retainedScopes.flatMap((owner) =>
      owner.snapshot().visitedWorkers.ids.map((id) => ({
        id,
        key: `${owner.viewKey}:${id}`,
        events: owner.transcripts(api).snapshot().events[id],
      })),
    ),
    ...(project.visitedRelayWorkers ?? []).map((id) => ({
      id,
      key: `relay:${id}`,
      events: undefined,
    })),
  ];
  const runsById = new Map(
    [
      ...Object.values(state?.projectViews ?? {}).flatMap((view) => view.runs),
      ...(snapshot?.runs ?? []),
    ].map((run) => [run.record.id, run]),
  );
  const plans =
    snapshot?.chats.filter((chat) => chat.kind !== "relay").flatMap((chat) => chat.plans ?? []) ??
    [];
  const relayWorker = snapshot?.runs.find((run) => run.record.id === workerId)?.relay;
  const relay = snapshot?.chats.find(
    (chat) =>
      chat.kind === "relay" &&
      (relayWorker
        ? chat.conversationId === relayWorker.conversationId
        : chat.conversationId === snapshot?.chat.conversationId),
  );
  const relayActive = snapshot?.chat.kind === "relay" && !workerId;
  const relayWorkerActive = !!snapshot?.runs.find((run) => run.record.id === workerId)?.relay;
  const recallSource = selectedRecallSource(state, workerId, transcripts, scope.viewKey);
  const reviewSummaries = snapshot?.reviews ?? [];
  const projectFiles =
    showsProjectFiles(snapshot, workerId) ||
    (project.explicitProjectFiles === true && !relayWorkerActive);
  const projectNotice =
    snapshot?.chat.kind !== "relay" && directory && snapshot?.gitReadiness ? (
      <GitReadinessNotice
        state={snapshot.gitReadiness}
        onSetup={() => setGitSetupProject(directory)}
        onCheck={() => {
          const current = scope.capture();
          void api
            .checkGit({
              project: directory,
              ...(snapshot?.projectInstanceId
                ? { projectId: snapshot.projectInstanceId, databaseEpoch: snapshot.databaseEpoch }
                : {}),
            })
            .catch((cause) => {
              if (current()) setError(message(cause));
            });
        }}
      />
    ) : null;
  return (
    <div
      className="chat-workspace-body"
      data-file-panel-open={
        projectFiles ? explorerOpen : relayActive || relayWorkerActive ? relayPanelOpen : undefined
      }
    >
      <div className="chat-conversations">
        {gitSetupProject === directory && gitSetupProject && (
          <GitSetupDialog
            key={`${snapshot?.projectInstanceId}:${snapshot?.databaseEpoch}`}
            api={api}
            project={gitSetupProject}
            projectId={snapshot?.projectInstanceId ?? undefined}
            databaseEpoch={snapshot?.databaseEpoch}
            onClose={() => setGitSetupProject(undefined)}
          />
        )}

        {(snapshot?.chats.length ? snapshot.chats : [snapshot?.chat]).map((chat) => (
          <ChatPage
            key={
              chat?.kind === "relay"
                ? chatDraftKey(chat)
                : `${database}:${chat?.run?.id ?? chat?.directory ?? "disconnected"}`
            }
            api={api}
            notice={chat?.kind === "relay" ? null : projectNotice}
            chat={
              chat ? { ...chat, title: conversationTitle(snapshot?.chats ?? [], chat) } : undefined
            }
            hidden={
              !conversationActive || !!workerId || !isSelectedConversation(chat, snapshot?.chat)
            }
            events={state?.chatEventsByRun[chat?.run?.id ?? ""] ?? []}
            database={chat?.kind === "relay" ? null : database}
            commands={chat?.kind === "relay" ? [] : (snapshot?.commands ?? [])}
            project={
              chat?.kind === "relay"
                ? null
                : (snapshot?.openProjects?.find((project) => project.id === chat?.projectId)
                    ?.path ??
                  directory ??
                  null)
            }
            runs={snapshot?.runs ?? []}
            reviews={reviewSummaries}
            onReview={openReview}
            onRevisionPreview={(preview) => {
              if (preview.scope.kind === "relay") {
                setRevisionPreview((current) => ({ id: (current?.id ?? 0) + 1, preview }));
                setPanelOpen((s) => ({ ...s, [panelKey]: true }));
              } else {
                fileAction({ type: "ensure-changes" });
                fileAction(
                  preview.application
                    ? { type: "application", preview }
                    : {
                        type: "revision",
                        reviewId: preview.scope.reviewId,
                        revisionId: preview.revisionId,
                        title: preview.title,
                        scope: preview.scope,
                        ...(preview.related ? { related: preview.related } : {}),
                      },
                );
                setExplorerOpen(true);
              }
            }}
            active={
              !splash &&
              conversationActive &&
              !workerId &&
              isSelectedConversation(chat, snapshot?.chat)
            }
            onDatabase={() => showPicker("database")}
            onCopied={() => notify("Copied.")}
          />
        ))}
        {workerViews.map(({ id, key, events }) => {
          const run = runsById.get(id);
          if (!run) return null;
          return (
            <WorkerChat
              key={key}
              notice={run.relay ? null : projectNotice}
              api={api}
              run={run}
              label={workerLabel(snapshot?.chats ?? [], run)}
              orchestrated={snapshot?.workers.includes(id) ?? false}
              events={
                snapshot?.liveIds.includes(id) || workerId === id
                  ? (transcripts.events[id] ?? events ?? [])
                  : (events ?? transcripts.events[id] ?? [])
              }
              active={!splash && conversationActive && workerId === id}
              request={chatRequest}
              loading={
                !snapshot?.liveIds.includes(id) &&
                transcripts.events[id] === undefined &&
                !transcripts.errors[id]
              }
              historyError={transcripts.errors[id]}
              onRetry={transcripts.retry}
              onCopied={() => notify("Copied.")}
            />
          );
        })}
      </div>
      <section className="project-file-panel-scope" hidden={!projectFiles}>
        <RetainedProjectPanels
          id={scope.viewKey}
          liveIds={project.retainedScopes.map((owner) => owner.viewKey)}
        >
          <FilePanel
            disabled={!database}
            plans={plans}
            api={api}
            recallSource={recallSource}
            reviews={reviewSummaries}
            project={directory ?? ""}
            targetLabel={
              project.explicitProjectFiles && snapshot?.chat.kind === "relay"
                ? (directory ?? undefined)
                : undefined
            }
            currentChat={snapshot?.chat.run?.id}
            knowledgeOwner={
              snapshot?.projectInstanceId && snapshot.databaseEpoch !== undefined
                ? {
                    kind: "project",
                    projectId: snapshot.projectInstanceId,
                    databaseEpoch: snapshot.databaseEpoch,
                  }
                : undefined
            }
            key={scope.viewKey}
            tabs={currentFileTabs}
            onAction={fileAction}
            browser={fileBrowser}
            open={explorerOpen}
            onToggle={() => setExplorerOpen((value) => !value)}
            active={!splash && conversationActive && projectFiles}
            onOpenProject={() => showPicker("project")}
          />
        </RetainedProjectPanels>
      </section>
      {snapshot?.chats
        .filter((chat) => chat.kind === "relay")
        .map((owner) => (
          <RelayPlansPanel
            key={`${owner.conversationId}:${owner.generation}`}
            snapshot={{ ...snapshot, chat: owner }}
            api={api}
            plans={owner.plans ?? []}
            conversationId={owner.conversationId}
            generation={owner.generation}
            active={
              !splash &&
              conversationActive &&
              owner.conversationId === relay?.conversationId &&
              (relayActive || relayWorkerActive) &&
              !projectFiles
            }
            recallSource={recallSource}
            open={panelOpen[owner.conversationId ?? ""] ?? false}
            onOpen={(open) => setPanelOpen((s) => ({ ...s, [owner.conversationId ?? ""]: open }))}
            revisionPreview={revisionPreview}
          />
        ))}
    </div>
  );
}
