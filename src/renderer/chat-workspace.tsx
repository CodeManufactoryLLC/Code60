import { useState } from "react";
import type { AppPagesProps } from "./app-page-props.js";
import { ChatPage } from "./chat-page.js";
import { conversationTitle, workerLabel } from "./chats.js";
import { showsProjectFiles } from "./file-navigation.js";
import { FilePanel } from "./file-panel.js";
import { GitReadinessNotice, GitSetupDialog } from "./git-setup.js";
import { RelayPlansPanel } from "./relay-plans-panel.js";
import { RetainedProjectPanels } from "./retained-project-panels.js";
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
}: ChatWorkspaceProps) {
  const snapshot = state?.snapshot;
  const [relayPanelOpen, setRelayPanelOpen] = useState(false);
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
  const relay = snapshot?.chats.find((chat) => chat.kind === "relay");
  const relayActive = snapshot?.chat.kind === "relay" && !workerId;
  const reviewSummaries = snapshot?.reviews ?? [];
  const projectFiles =
    showsProjectFiles(snapshot, workerId) || project.explicitProjectFiles === true;
  return (
    <div
      className="chat-workspace-body"
      data-file-panel-open={projectFiles ? explorerOpen : relayActive ? relayPanelOpen : undefined}
    >
      <div className="chat-conversations">
        {snapshot?.chat.kind !== "relay" && directory && snapshot?.gitReadiness && (
          <GitReadinessNotice
            state={snapshot.gitReadiness}
            onSetup={() => setGitSetupProject(directory)}
            onCheck={() => {
              const current = scope.capture();
              void api
                .checkGit({
                  project: directory,
                  ...(snapshot?.projectInstanceId
                    ? {
                        projectId: snapshot.projectInstanceId,
                        databaseEpoch: snapshot.databaseEpoch,
                      }
                    : {}),
                })
                .catch((cause) => {
                  if (current()) setError(message(cause));
                });
            }}
          />
        )}
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
                ? (chat.conversationId ?? "relay")
                : `${database}:${chat?.run?.id ?? chat?.directory ?? "disconnected"}`
            }
            api={api}
            chat={
              chat ? { ...chat, title: conversationTitle(snapshot?.chats ?? [], chat) } : undefined
            }
            hidden={
              tabs.active !== "chat" || !!workerId || chat?.directory !== snapshot?.chat.directory
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
            active={
              !splash &&
              tabs.active === "chat" &&
              !workerId &&
              chat?.directory === snapshot?.chat.directory
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
              api={api}
              run={run}
              label={workerLabel(snapshot?.chats ?? [], run)}
              orchestrated={snapshot?.workers.includes(id) ?? false}
              events={
                snapshot?.liveIds.includes(id) || workerId === id
                  ? (transcripts.events[id] ?? events ?? [])
                  : (events ?? transcripts.events[id] ?? [])
              }
              active={!splash && tabs.active === "chat" && workerId === id}
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
            reviews={reviewSummaries}
            project={directory ?? ""}
            targetLabel={
              project.explicitProjectFiles && snapshot?.chat.kind === "relay"
                ? (directory ?? undefined)
                : undefined
            }
            currentChat={snapshot?.chat.run?.id}
            key={scope.viewKey}
            tabs={currentFileTabs}
            onAction={fileAction}
            browser={fileBrowser}
            open={explorerOpen}
            onToggle={() => setExplorerOpen((value) => !value)}
            active={!splash && tabs.active === "chat" && projectFiles}
            onOpenProject={() => showPicker("project")}
          />
        </RetainedProjectPanels>
      </section>
      <RelayPlansPanel
        snapshot={snapshot}
        api={api}
        plans={relay?.plans ?? []}
        conversationId={relay?.conversationId}
        active={!splash && tabs.active === "chat" && relayActive && !projectFiles}
        open={relayPanelOpen}
        onOpen={setRelayPanelOpen}
      />
    </div>
  );
}
