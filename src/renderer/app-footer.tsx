import type { AppPagesProps } from "./app-page-props.js";
import { Button as AppButton } from "./carbon/button.js";
import { newestMessage } from "./chat-presentation.js";
import { PollingWidget } from "./polling.js";
import { SidebarFooterActions } from "./sidebar-footer-actions.js";
import { UpdateIndicator, type useUpdates } from "./updates.js";

type FooterProps = Pick<
  AppPagesProps,
  | "api"
  | "state"
  | "transcripts"
  | "tabs"
  | "workerId"
  | "busy"
  | "showPicker"
  | "navigation"
  | "navigationRuns"
> & {
  updates: ReturnType<typeof useUpdates>;
  openUpdates(): void;
  onReturn(): void;
  closeWorkspace(): void;
};
export function AppFooter({
  api,
  state,
  transcripts,
  tabs,
  workerId,
  busy,
  showPicker,
  navigation,
  navigationRuns,
  updates,
  openUpdates,
  onReturn,
  closeWorkspace,
}: FooterProps) {
  const snapshot = state?.snapshot;
  const database = snapshot?.database ?? null;
  const waiting = [
    ...(snapshot?.chats ?? []).map((chat) => chat.run),
    ...navigationRuns.map((run) => run.view),
  ].filter((run) => run != null && run.pending.length > 0);
  const first = waiting[0];
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
          onDatabase={() => {
            closeWorkspace();
            showPicker("database");
          }}
          onReturn={onReturn}
        />
      </div>
      <UpdateIndicator
        state={updates.state}
        onOpen={() => {
          closeWorkspace();
          openUpdates();
        }}
      />
      {first && (
        <AppButton
          type="button"
          className="footer-note"
          onClick={() => {
            closeWorkspace();
            void navigation.open({ kind: "conversation", id: first.id });
          }}
        >
          {waiting.reduce((sum, run) => sum + (run?.pending.length ?? 0), 0)} approvals waiting
        </AppButton>
      )}
      <div className="app-version" role="note" aria-label="Running Code60 version">
        Code60 {snapshot?.versions.code60 ?? "Version unavailable"}
      </div>
    </footer>
  );
}
