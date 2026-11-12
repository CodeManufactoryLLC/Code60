import type { AppPagesProps } from "./app-page-props.js";
import { ChatPage } from "./chat-page.js";
import { workerLabel } from "./chats.js";
import { FilePanel } from "./file-panel.js";
import { GitReadinessNotice, GitSetupDialog } from "./git-setup.js";
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
  const {
    scope,
    gitSetupProject,
    setGitSetupProject,
    visitedWorkers,
    chatRequest,
    fileTabs: currentFileTabs,
    explorerOpen,
    setExplorerOpen,
  } = project;
  const database = scope.database;
  const directory = scope.project;
  const workspace = scope.workspace;
  const workerScope = workspace;
  const plans = snapshot?.chats.flatMap((chat) => chat.plans ?? []) ?? [];
  const reviewSummaries = snapshot?.reviews ?? [];
  return (
    <div className="chat-workspace-body">
      <div className="chat-conversations">
        {directory && snapshot?.gitReadiness && (
          <GitReadinessNotice
            state={snapshot.gitReadiness}
            onSetup={() => setGitSetupProject(directory)}
            onCheck={() => {
              const current = scope.capture();
              void api.checkGit({ project: directory }).catch((cause) => {
                if (current()) setError(message(cause));
              });
            }}
          />
        )}
        {gitSetupProject === directory && gitSetupProject && (
          <GitSetupDialog
            api={api}
            project={gitSetupProject}
            onClose={() => setGitSetupProject(undefined)}
          />
        )}

        {(snapshot?.chats.length ? snapshot.chats : [snapshot?.chat]).map((chat, index) => (
          <ChatPage
            key={chat?.run?.id ?? chat?.directory ?? "disconnected"}
            api={api}
            chat={chat ? { ...chat, title: chat.title ?? `Chat ${index + 1}` } : undefined}
            hidden={
              tabs.active !== "chat" || !!workerId || chat?.directory !== snapshot?.chat.directory
            }
            events={state?.chatEventsByRun[chat?.run?.id ?? ""] ?? []}
            database={database}
            commands={snapshot?.commands ?? []}
            project={directory ?? null}
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
        {(visitedWorkers.workspace === workerScope ? visitedWorkers.ids : []).map((id) => {
          const run = snapshot?.runs.find(({ record }) => record.id === id);
          if (!run) return null;
          return (
            <WorkerChat
              key={`${scope.viewKey}:${id}`}
              api={api}
              run={run}
              label={workerLabel(snapshot?.chats ?? [], run)}
              orchestrated={snapshot?.workers.includes(id) ?? false}
              events={transcripts.events[id] ?? []}
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
      <FilePanel
        disabled={!database}
        plans={plans}
        api={api}
        reviews={reviewSummaries}
        project={directory ?? ""}
        currentChat={snapshot?.chat.run?.id}
        key={scope.viewKey}
        tabs={currentFileTabs}
        onAction={fileAction}
        browser={fileBrowser}
        open={explorerOpen}
        onToggle={() => setExplorerOpen((value) => !value)}
        active={!splash && tabs.active === "chat"}
        onOpenProject={() => showPicker("project")}
      />
    </div>
  );
}
