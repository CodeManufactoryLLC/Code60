import type { RecallSource } from "./memory-recall.js";
import type { DesktopState } from "./snapshot-state.js";
import type { Transcripts } from "./transcripts.js";

/** Bind to the displayed chat, not whichever project or orchestrator is selected. */
export function selectedRecallSource(
  state: DesktopState | undefined,
  workerId: string | undefined,
  transcripts: Pick<Transcripts, "events" | "errors" | "retry">,
  projectKey: string,
): RecallSource | undefined {
  if (!state) return;
  const { snapshot } = state;
  if (workerId) {
    const run = snapshot.runs.find((run) => run.record.id === workerId);
    if (!run) return;
    const parent = snapshot.chats.find((chat) => chat.workers?.includes(workerId));
    return {
      owner: JSON.stringify([
        run.relay
          ? [
              "relay-worker",
              run.relay.conversationId,
              run.relay.generation,
              run.relay.targetId,
              run.relay.taskId,
            ]
          : [
              projectKey,
              snapshot.projectInstanceId,
              snapshot.databaseEpoch,
              parent?.run?.id,
              parent?.generation,
            ],
        workerId,
        run.record.startedAt,
      ]),
      runId: workerId,
      events: transcripts.events[workerId] ?? [],
      loading:
        !snapshot.liveIds.includes(workerId) &&
        !transcripts.events[workerId] &&
        !transcripts.errors[workerId],
      error: !!transcripts.errors[workerId],
      retry: transcripts.retry,
    };
  }
  const chat = snapshot.chat;
  const runId = chat.run?.id;
  if (!runId) return;
  return {
    owner: JSON.stringify(
      chat.kind === "relay"
        ? ["relay", chat.conversationId, chat.generation, runId]
        : [
            projectKey,
            chat.projectId,
            snapshot.databaseEpoch,
            chat.conversationId,
            chat.generation,
            runId,
          ],
    ),
    runId,
    events: state.chatEventsByRun[runId] ?? [],
  };
}
