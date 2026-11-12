import type { DesktopRun } from "../bridge/index.js";
import type { AppPagesProps } from "./app-page-props.js";
import type { IconName } from "./icons.js";
import type { Command } from "./overlays.js";
import { continueBlocker } from "./recovery.js";

type SessionActions = Pick<AppPagesProps, "busy" | "act" | "openChat"> & {
  directory: string | null | undefined;
  browseFiles(): Promise<void>;
  reviewRun(id: string): Promise<void>;
  resume(id: string): void;
  setSelected(id: string): void;
};
const activeStatuses = new Set(["queued", "running", "waiting", "idle"]);
const statusOf = (run: DesktopRun) => run.view?.status ?? run.record.status;
const hasWorktree = (run: DesktopRun) => run.record.base !== null && !run.record.discardedAt;
const unless = (blocked: boolean, reason: string) => (blocked ? reason : undefined);
export function createSessionCommands(
  target: DesktopRun,
  { busy, directory, act, openChat, browseFiles, reviewRun, resume, setSelected }: SessionActions,
): Command[] {
  const status = statusOf(target);
  const view = target.view;
  const waitBusy = "Wait for the current action to finish";
  const reasons = {
    browse: busy ? waitBusy : unless(!directory, "Open a project to browse files"),
    review: busy
      ? waitBusy
      : unless(!hasWorktree(target), "This run has no worktree, so there is no diff"),
    cancel: busy
      ? waitBusy
      : unless(
          !view || !["running", "waiting"].includes(status) || view.stopping,
          "Available while the agent is working on a turn",
        ),
    finish: busy
      ? waitBusy
      : unless(
          !view || status !== "idle" || view.stopping,
          "Available when the agent is ready for a prompt",
        ),
    resume: busy ? waitBusy : continueBlocker(target),
    stop: busy ? waitBusy : unless(!target.agentAlive, "No leftover agent process is running"),
    discard: busy
      ? waitBusy
      : !hasWorktree(target)
        ? "This run has no worktree to delete"
        : unless(
            activeStatuses.has(status) || target.agentAlive,
            "Available after the run ends and its agent stops",
          ),
  };
  const entry = (
    id: keyof typeof reasons | "chat",
    label: string,
    icon: IconName,
    run: () => void,
  ): Command => {
    const reason = id === "chat" ? undefined : reasons[id];
    return {
      id,
      label,
      icon,
      group: "Session",
      disabled: reason !== undefined,
      ...(reason ? { reason } : {}),
      ...(id === "discard" || id === "stop" ? { danger: true } : {}),
      run,
    };
  };
  return [
    entry("chat", "Open chat", "chat", () => {
      setSelected(target.record.id);
      openChat(target.record.id);
    }),
    entry("review", "Review changes", "task--tools", () => void reviewRun(target.record.id)),
    entry("browse", "Browse project files", "document", () => void browseFiles()),
    entry(
      "cancel",
      "Cancel turn",
      "stop",
      () => void act({ type: "cancel", id: target.record.id }),
    ),
    entry(
      "finish",
      "Finish run",
      "checkmark--outline",
      () => void act({ type: "finish", id: target.record.id }),
    ),
    entry("resume", "Resume", "renew", () => resume(target.record.id)),
    entry(
      "stop",
      "Stop leftover agent",
      "close",
      () => void act({ type: "stop", id: target.record.id }),
    ),
    entry(
      "discard",
      "Delete worktree",
      "trash-can",
      () => void act({ type: "discard", id: target.record.id }),
    ),
  ];
}
