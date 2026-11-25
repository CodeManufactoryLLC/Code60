import { useState } from "react";
import type { AppPagesProps } from "./app-page-props.js";
import { Surface as Card } from "./carbon/surfaces.js";
import { chatDraftKey } from "./chat-draft.js";
import { ChatPage } from "./chat-page.js";
import { chatEventKey, conversationTitle, isSelectedConversation, workerLabel } from "./chats.js";
import { ContentHeaderSlot } from "./content-page-header.js";
import { showsProjectFiles } from "./file-navigation.js";
import { FilePanel } from "./file-panel.js";
import { GitReadinessNotice, GitSetupDialog } from "./git-setup.js";
import { selectedRecallSource } from "./memory-recall-source.js";
import { RelayPlansPanel } from "./relay-plans-panel.js";
import { RetainedProjectPanels } from "./retained-project-panels.js";
import type { ReviewPreview } from "./review-actions.js";
import { projectChatIdentity } from "./session-panel.js";
import { selectedTerminalSource } from "./terminal-source.js";
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
  const selectionPending = navigation.projectPending || navigation.conversationPending;
  const conversationActive = tabs.active === "chat" && !selectionPending;
  const [panelOpen, setPanelOpen] = useState<Record<string, boolean>>({});
  const panelKey =
    snapshot?.runs.find((run) => run.record.id === workerId)?.relay?.conversationId ??
    snapshot?.chat.conversationId ??
    "";
  const relayPanelOpen = panelOpen[panelKey] ?? false;
  const [planRequest, setPlanRequest] = useState<{ conversationId: string; serial: number }>();
  const [revisionPreview, setRevisionPreview] = useState<{ id: number; preview: ReviewPreview }>();
  const {
    scope,
    gitSetupProject,
    setGitSetupProject,
    chatRequest,
    fileTabs: currentFileTabs,
    filePanel,
    explorerOpen,
    setExplorerOpen,
  } = project;
  const database = scope.database;
  const directory = scope.project;
  const workerViews = [
    ...project.retainedScopes.flatMap((owner) => {
      const projectId = snapshot?.openProjects?.find((entry) => entry.path === owner.project)?.id;
      const current = owner.viewKey === scope.viewKey;
      const runs = current
        ? snapshot?.runs
        : projectId
          ? state?.projectViews?.[projectId]?.runs
          : [];
      return owner.snapshot().visitedWorkers.ids.map((id) => ({
        id,
        key: `${owner.viewKey}:${id}`,
        events: owner.transcripts(api).snapshot().events[id],
        run: runs?.find((run) => !run.relay && run.record.id === id),
        current,
      }));
    }),
    ...(project.visitedRelayWorkers ?? []).map((id) => ({
      id,
      key: `relay:${id}`,
      events: undefined,
      run: snapshot?.runs.find((run) => run.relay && run.record.id === id),
      current: true,
    })),
  ];
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
  const displayedRelayPlan = relayActive ? relay?.plans?.at(-1) : undefined;
  const relayWorkerActive = !!snapshot?.runs.find((run) => run.record.id === workerId)?.relay;
  const recallSource = selectedRecallSource(state, workerId, transcripts, scope.viewKey);
  const terminalSource = selectedTerminalSource(state, workerId);
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
      <Card className="chat-conversations">
        <div id="workspace-panel-actions" />
        <ContentHeaderSlot />
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
                : `${database}:${chat?.projectId}:${projectChatIdentity(chat?.run?.id, chat?.directory)}`
            }
            api={api}
            notice={chat?.kind === "relay" ? null : projectNotice}
            autoApproval={snapshot?.orchestration.allowAll ?? true}
            chat={
              chat ? { ...chat, title: conversationTitle(snapshot?.chats ?? [], chat) } : undefined
            }
            hidden={
              tabs.active !== "chat" || !!workerId || !isSelectedConversation(chat, snapshot?.chat)
            }
            selectionPending={selectionPending}
            events={chat ? (state?.chatEventsByRun[chatEventKey(chat)] ?? []) : []}
            request={chat?.projectId === snapshot?.projectInstanceId ? chatRequest : undefined}
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
        {workerViews.map(({ id, key, events, run, current }) => {
          if (!run) return null;
          return (
            <WorkerChat
              key={key}
              notice={run.relay ? null : projectNotice}
              api={api}
              run={run}
              label={workerLabel(snapshot?.chats ?? [], run)}
              autoApproval={snapshot?.orchestration.allowAll ?? true}
              orchestrated={snapshot?.workers.includes(id) ?? false}
              events={
                current && (snapshot?.liveIds.includes(id) || workerId === id)
                  ? (transcripts.events[id] ?? events ?? [])
                  : (events ?? transcripts.events[id] ?? [])
              }
              active={current && !splash && conversationActive && workerId === id}
              hidden={!current || splash || tabs.active !== "chat" || workerId !== id}
              selectionPending={selectionPending}
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
      </Card>
      <section className="project-file-panel-scope" hidden={!projectFiles}>
        <RetainedProjectPanels
          id={filePanel.identity}
          liveIds={project.retainedScopes.flatMap((owner) =>
            [...owner.panels.values()].map((panel) => panel.identity),
          )}
        >
          <FilePanel
            disabled={!database}
            plans={plans}
            viewPlan={displayedRelayPlan}
            onViewPlan={
              displayedRelayPlan && relay?.conversationId
                ? () => {
                    project.showConversationFiles?.();
                    setPlanRequest((previous) => ({
                      conversationId: relay.conversationId as string,
                      serial: (previous?.serial ?? 0) + 1,
                    }));
                  }
                : undefined
            }
            api={api}
            recallSource={recallSource}
            terminalSource={terminalSource}
            reviews={reviewSummaries}
            project={directory ?? ""}
            targetLabel={
              project.explicitProjectFiles && snapshot?.chat.kind === "relay"
                ? (directory ?? undefined)
                : undefined
            }
            currentChat={workerId ? undefined : snapshot?.chat.run?.id}
            knowledgeOwner={
              snapshot?.projectInstanceId && snapshot.databaseEpoch !== undefined
                ? {
                    kind: "project",
                    projectId: snapshot.projectInstanceId,
                    databaseEpoch: snapshot.databaseEpoch,
                  }
                : undefined
            }
            key={filePanel.identity}
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
        .flatMap((owner) =>
          [
            undefined,
            ...workerViews
              .filter(({ run }) => {
                const worker = run?.relay;
                return (
                  worker &&
                  worker.conversationId === owner.conversationId &&
                  worker.generation === owner.generation
                );
              })
              .map(({ id }) => id),
          ].map((id) => (
            <RelayPlansPanel
              key={`${owner.conversationId}:${owner.generation}:${id ?? "relay"}`}
              snapshot={{ ...snapshot, chat: owner }}
              api={api}
              plans={id ? [] : (owner.plans ?? [])}
              conversationId={owner.conversationId}
              currentChat={!id ? owner.conversationId : undefined}
              generation={owner.generation}
              active={
                !splash &&
                conversationActive &&
                owner.conversationId === relay?.conversationId &&
                (id ? relayWorkerActive && workerId === id : relayActive) &&
                !projectFiles
              }
              recallSource={recallSource}
              terminalSource={
                id
                  ? selectedTerminalSource(state, id)
                  : {
                      target: {
                        kind: "relay",
                        ...(owner.conversationId ? { conversationId: owner.conversationId } : {}),
                      },
                      label: owner.title?.trim() || "Relay",
                    }
              }
              open={panelOpen[owner.conversationId ?? ""] ?? false}
              onOpen={(open) => setPanelOpen((s) => ({ ...s, [owner.conversationId ?? ""]: open }))}
              planRequest={id ? undefined : planRequest}
              revisionPreview={id ? undefined : revisionPreview}
            />
          )),
        )}
    </div>
  );
}
