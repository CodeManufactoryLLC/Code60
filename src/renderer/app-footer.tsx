import type { AppPagesProps } from "./app-page-props.js";
import { newestMessage } from "./chat-presentation.js";
import { PollingWidget } from "./polling.js";
import { SidebarFooterActions } from "./sidebar-footer-actions.js";
import { UpdateIndicator, type useUpdates } from "./updates.js";

type FooterProps = Pick<
  AppPagesProps,
  "api" | "state" | "transcripts" | "tabs" | "workerId" | "busy" | "showPicker" | "openChat"
> & {
  updates: ReturnType<typeof useUpdates>;
  openUpdates(): void;
  onReturn(): void;
};
export function AppFooter({
  api,
  state,
  transcripts,
  tabs,
  workerId,
  busy,
  showPicker,
  openChat,
  updates,
  openUpdates,
  onReturn,
}: FooterProps) {
  const snapshot = state?.snapshot;
  const database = snapshot?.database ?? null;
  return (
    <footer className="app-footer">
      <div className="footer-sidebar">
        {snapshot && (
          <PollingWidget
            disabled={!database}
            key={database ?? "none"}
            polling={snapshot.polling}
            api={api}
            messageScope={
              tabs.active === "chat" ? "selected conversation" : "current project sessions"
            }
            messageAt={
              tabs.active === "chat"
                ? workerId && (transcripts.errors[workerId] || !transcripts.events[workerId])
                  ? null
                  : newestMessage(
                      workerId ? (transcripts.events[workerId] ?? []) : (state?.chatEvents ?? []),
                    )
                : transcripts.pending || Object.keys(transcripts.errors).length
                  ? null
                  : newestMessage(
                      snapshot.runs.flatMap(({ record }) => [
                        ...(transcripts.events[record.id] ?? []),
                      ]),
                    )
            }
          />
        )}
        <SidebarFooterActions
          returnDisabled={busy || !snapshot}
          databaseDisabled={busy || !snapshot || Boolean(snapshot.active)}
          onDatabase={() => showPicker("database")}
          onReturn={onReturn}
        />
      </div>
      <UpdateIndicator state={updates.state} onOpen={openUpdates} />
      {snapshot?.runs.some((run) => run.view?.pending.length) && (
        <button
          type="button"
          className="footer-note"
          onClick={() => {
            const waiting = snapshot.runs.find((run) => run.view?.pending.length);
            if (waiting) openChat(waiting.record.id);
          }}
        >
          {snapshot.runs.reduce((sum, run) => sum + (run.view?.pending.length ?? 0), 0)} approvals
          waiting
        </button>
      )}
      <div className="app-version" role="note" aria-label="Running Code60 version">
        Code60 {snapshot?.versions.code60 ?? "Version unavailable"}
      </div>
    </footer>
  );
}
