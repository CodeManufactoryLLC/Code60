import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SearchSummarySource } from "../bridge/index.js";
import {
  type CoreDeps,
  createRecordStore,
  directoryRunsDir,
  openWorkspace,
  type RunEvent,
  type RunRecord,
  readOrchestrationChat,
  stateHome,
} from "../core/index.js";
import { ChatCheckpoints } from "./chat-checkpoints.js";
import { ChatStore } from "./chat-store.js";
import { mergeRagEvents } from "./rag-sources.js";
import { RAG_LIMITS, readRagFile } from "./rag-store.js";
import { projectSearchEvidence } from "./search-evidence.js";

export type SearchEvidence = SearchSummarySource & { at: string };
export interface SearchLiveHistory {
  runId: string;
  events: readonly RunEvent[];
  title?: string | undefined;
}
export type SearchEvidenceReader = (
  project: string,
  query: string,
  includeFiles: boolean,
  signal: AbortSignal,
  add: (source: SearchEvidence) => void,
  issue: (description: string) => void,
) => Promise<void>;
export function projectChatRoot(database: string, project: string): string {
  return join(
    dirname(database),
    ".code60_workspace",
    "projects",
    createHash("sha256")
      .update(JSON.stringify([database, project]))
      .digest("hex"),
  );
}

/** Preserve the first event's address while reconstructing streamed text. */
function emitHistory(
  record: RunRecord,
  events: readonly RunEvent[],
  title: string | undefined,
  add: (source: SearchEvidence) => void,
) {
  add({
    id: record.id,
    kind: "run",
    runId: record.id,
    title: title ?? `${record.agent} / ${record.id}`,
    text: [record.firstPrompt, record.status, record.branch, record.worktree]
      .filter(Boolean)
      .join("\n"),
    at: record.startedAt,
  });
  let pending: SearchEvidence | undefined;
  const flush = () => {
    if (pending) add(pending);
    pending = undefined;
  };
  for (const [index, event] of events.entries()) {
    if (event.type === "acp" || event.type === "sessionState") continue;
    if (event.type === "message" || event.type === "thought") {
      if (pending?.kind === event.type) pending.text += event.text;
      else {
        flush();
        pending = {
          id: `${record.id}:${index}`,
          kind: event.type,
          runId: record.id,
          eventIndex: index,
          title: `${event.type === "message" ? "Message" : "Thought"} / ${record.agent} / ${record.id.slice(-6)}`,
          text: event.text,
          at: event.at,
        };
      }
    } else {
      flush();
      if (event.type === "prompt")
        add({
          id: `${record.id}:${index}`,
          kind: "prompt",
          runId: record.id,
          eventIndex: index,
          title: `Prompt / ${record.agent} / ${record.id.slice(-6)}`,
          text: event.text,
          at: event.at,
        });
    }
  }
  flush();
}

/** Read existing stores only: no reconciliation, registry restoration or directory creation. */
export function projectEvidenceReader(
  deps: CoreDeps,
  env: Readonly<Record<string, string | undefined>>,
  database: string,
  live: ReadonlyMap<string, readonly SearchLiveHistory[]>,
): SearchEvidenceReader {
  return async (project, query, includeFiles, signal, add, issue) => {
    let remaining = RAG_LIMITS.sourceBytes;
    const take = (text: string) => {
      remaining -= Buffer.byteLength(text);
      if (remaining < 0) throw new Error("Project history read limit reached");
      return text;
    };
    const bounded: CoreDeps = {
      ...deps,
      fs: {
        ...deps.fs,
        readFile: async (path) => {
          signal.throwIfAborted();
          for (const parent of [dirname(path), dirname(dirname(path))]) {
            const info = await lstat(parent);
            if (!info.isDirectory() || info.isSymbolicLink())
              throw new Error("Unsafe history directory");
          }
          return take(
            await readRagFile(
              path,
              Math.max(
                0,
                Math.min(path.endsWith("run.json") ? 1_048_576 : 32 * 1_048_576, remaining),
              ),
            ),
          );
        },
      },
    };
    const workers: RunRecord[] = [];
    const seen = new Set<string>();
    try {
      const workspace = await openWorkspace(bounded, project, env);
      const legacy = createRecordStore(bounded.fs, directoryRunsDir(stateHome(env), project));
      for (const store of workspace.store.dir === legacy.dir
        ? [workspace.store]
        : [workspace.store, legacy]) {
        signal.throwIfAborted();
        const info = await lstat(store.dir).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (!info) continue;
        if (!info.isDirectory() || info.isSymbolicLink()) {
          issue("Saved history is unsafe");
          continue;
        }
        const names = await bounded.fs.readdir(store.dir);
        if (names.length > RAG_LIMITS.conversations)
          issue("Some saved history exceeds the project read limit");
        for (const id of names
          .slice(0, RAG_LIMITS.conversations)
          .filter((id) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(id))) {
          signal.throwIfAborted();
          try {
            const record = await store.read(id);
            if (record.owner === "relay") continue;
            if (seen.has(id)) {
              issue("Conflicting saved session IDs");
              continue;
            }
            seen.add(id);
            workers.push(record);
            workerStores.set(record, store);
          } catch {
            signal.throwIfAborted();
            issue("Some saved session records could not be read");
          }
        }
      }
    } catch {
      signal.throwIfAborted();
      issue("Saved project history could not be read");
    }
    const hidden = new Set<string>();
    const exclusions = new Map<string, { from: number; to: number }[]>();
    const captured = live.get(project) ?? [];
    const chatStore = new ChatStore(projectChatRoot(database, project));
    try {
      const exists = await lstat(chatStore.root).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (exists) {
        const snapshot = await chatStore.snapshot(true);
        if (snapshot.errors.length) issue("Some saved conversations could not be read");
        for (const saved of snapshot.chats) {
          signal.throwIfAborted();
          try {
            if (remaining <= 0) throw new Error("History limit reached");
            const directory = await chatStore.directory(saved.directoryId, true);
            const history = await readOrchestrationChat(
              {
                ...deps,
                fs: {
                  ...deps.fs,
                  readFile: async (path) => {
                    signal.throwIfAborted();
                    return take(
                      await chatStore.readHistory(saved.directoryId, saved.runId, path, true),
                    );
                  },
                },
              },
              directory,
              saved.runId,
              true,
              { readOnly: true },
            );
            if (history.record.agent !== saved.provider) throw new Error("Saved provider mismatch");
            const checkpoints = await ChatCheckpoints.read(join(directory, "checkpoints"));
            for (const id of checkpoints.hidden) hidden.add(id);
            for (const worker of workers) {
              const ranges = checkpoints.excluded(worker.id);
              if (ranges.length)
                exclusions.set(worker.id, [...(exclusions.get(worker.id) ?? []), ...ranges]);
            }
            const current = captured.find((entry) => entry.runId === saved.runId);
            // Keep original event indexes; masking with status events prevents indexing rewound text.
            const events = mergeRagEvents(history.events, current?.events ?? []).map(
              (event, index): RunEvent =>
                checkpoints.visible(saved.runId, index)
                  ? event
                  : {
                      type: "status",
                      runId: saved.runId,
                      at: event.at,
                      status: "interrupted",
                      reason: "Rewound event",
                    },
            );
            emitHistory(
              checkpoints.rewound ? { ...history.record, firstPrompt: "" } : history.record,
              events,
              current?.title ?? saved.title ?? undefined,
              add,
            );
          } catch {
            signal.throwIfAborted();
            issue("Some saved conversations could not be read");
          }
        }
      }
    } catch {
      signal.throwIfAborted();
      issue("Saved conversation storage could not be read");
    }
    for (const record of workers) {
      signal.throwIfAborted();
      if (hidden.has(record.id)) continue;
      try {
        const disk = await workerStores.get(record)?.readEvents(record.id);
        const current = captured.find((entry) => entry.runId === record.id);
        const events = mergeRagEvents(disk ?? [], current?.events ?? []).map(
          (event, index): RunEvent =>
            (exclusions.get(record.id) ?? []).some((r) => index >= r.from && index < r.to)
              ? {
                  type: "status",
                  runId: record.id,
                  at: event.at,
                  status: "interrupted",
                  reason: "Rewound event",
                }
              : event,
        );
        emitHistory(record, events, current?.title, add);
      } catch {
        signal.throwIfAborted();
        issue("Some saved transcripts could not be read");
        emitHistory(record, [], captured.find((entry) => entry.runId === record.id)?.title, add);
      }
    }
    if (includeFiles) {
      try {
        for (const source of await projectSearchEvidence(project, query, signal, undefined, issue))
          add({ ...source, at: "" });
      } catch {
        signal.throwIfAborted();
        issue("Some project files could not be read");
      }
    }
  };
}
// Weak keys retain no history between projects or requests.
const workerStores = new WeakMap<RunRecord, import("../core/index.js").Workspace["store"]>();
