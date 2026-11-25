import type { TerminalTarget } from "../bridge/index.js";
import { workerLabel } from "./chats.js";
import type { DesktopState } from "./snapshot-state.js";

export interface TerminalSource {
  target: TerminalTarget | null;
  label: string;
  unavailable?: string | undefined;
}

function pathBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts.at(-1) || path;
}

/** Resolve an opaque terminal target for the currently displayed chat or worker. */
export function selectedTerminalSource(
  state: DesktopState | undefined,
  workerId: string | undefined,
): TerminalSource | undefined {
  if (!state) return undefined;
  const { snapshot } = state;
  if (workerId) {
    const run =
      snapshot.runs.find((entry) => entry.record.id === workerId) ??
      Object.values(state.projectViews ?? {})
        .flatMap((view) => view.runs)
        .find((entry) => entry.record.id === workerId);
    if (!run) return undefined;
    const label = workerLabel(snapshot.chats, run);
    if (run.record.discardedAt !== undefined) {
      return {
        target: null,
        label,
        unavailable: "This agent's worktree was deleted.",
      };
    }
    if (run.relay) {
      return {
        target: {
          kind: "relay-worker",
          runId: workerId,
          ...(run.relay.conversationId ? { conversationId: run.relay.conversationId } : {}),
        },
        label,
      };
    }
    if (!snapshot.projectInstanceId || snapshot.databaseEpoch === undefined) {
      return {
        target: null,
        label,
        unavailable: "Open this worker's project to start a terminal.",
      };
    }
    return {
      target: {
        kind: "project-worker",
        runId: workerId,
        projectId: snapshot.projectInstanceId,
        databaseEpoch: snapshot.databaseEpoch,
      },
      label,
    };
  }

  const chat = snapshot.chat;
  if (chat.kind === "relay") {
    const label = chat.title?.trim() || "Relay";
    return {
      target: {
        kind: "relay",
        ...(chat.conversationId ? { conversationId: chat.conversationId } : {}),
      },
      label,
    };
  }

  const projectPath =
    snapshot.openProjects?.find((entry) => entry.id === chat.projectId)?.path ??
    snapshot.directory ??
    null;
  const projectId = chat.projectId ?? snapshot.projectInstanceId ?? null;
  if (!projectPath || !projectId || snapshot.databaseEpoch === undefined) {
    return {
      target: null,
      label: "Project",
      unavailable: "Open a project to start a terminal.",
    };
  }
  return {
    target: {
      kind: "project",
      projectId,
      databaseEpoch: snapshot.databaseEpoch,
    },
    label: pathBasename(projectPath),
  };
}
