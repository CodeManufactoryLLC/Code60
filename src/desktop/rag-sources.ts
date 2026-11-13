import { lstat } from "node:fs/promises";
import { dirname } from "node:path";
import { type CoreDeps, openWorkspace, type RunEvent, type Workspace } from "../core/index.js";
import { RAG_LIMITS, readRagFile } from "./rag-store.js";
import type { RagConversation } from "./rag-worker.js";

export function mergeRagEvents(disk: readonly RunEvent[], live: readonly RunEvent[]): RunEvent[] {
  const result = [...disk];
  const counts = new Map<string, number>();
  for (const event of disk) {
    const key = JSON.stringify(event);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const event of live) {
    const key = JSON.stringify(event);
    const count = counts.get(key) ?? 0;
    if (count) counts.set(key, count - 1);
    else result.push(event);
  }
  return result;
}

/** Core's tolerant history listing is unsuitable for an all-or-nothing index. Track every failed read. */
export async function ragProjectSources(
  deps: CoreDeps,
  env: Readonly<Record<string, string | undefined>>,
  projects: readonly string[],
  live: readonly RunEvent[] | Map<string, readonly RunEvent[]>,
  signal: AbortSignal,
  add: (conversation: RagConversation) => void,
): Promise<void> {
  const cache = new Map<string, string>();
  let bytes = 0;
  let failed = false;
  const bounded: CoreDeps = {
    ...deps,
    fs: {
      ...deps.fs,
      readdir: async (path) => {
        signal.throwIfAborted();
        const entries = await deps.fs.readdir(path);
        if (entries.length > RAG_LIMITS.conversations)
          throw new Error("Too many RAG history records");
        const info = await lstat(path);
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new Error("Unsafe RAG history directory");
        return entries;
      },
      readFile: async (path) => {
        signal.throwIfAborted();
        const cached = cache.get(path);
        if (cached !== undefined) return cached;
        try {
          for (const parent of [dirname(path), dirname(dirname(path))]) {
            const info = await lstat(parent);
            if (!info.isDirectory() || info.isSymbolicLink())
              throw new Error("Unsafe RAG history directory");
          }
          const text = await readRagFile(
            path,
            Math.min(
              path.endsWith("run.json") ? 1_048_576 : 32 * 1_048_576,
              RAG_LIMITS.sourceBytes - bytes,
            ),
          );
          bytes += Buffer.byteLength(text);
          cache.set(path, text);
          return text;
        } catch (error) {
          failed = true;
          throw error;
        }
      },
    },
  };
  const stores = new Set<string>();
  for (const directory of projects) {
    const projectLive = live instanceof Map ? (live.get(directory) ?? []) : live;
    signal.throwIfAborted();
    const info = await lstat(directory);
    if (!info.isDirectory())
      throw new Error(
        "A registered project is missing. Restore or remove it before rebuilding RAG.",
      );
    const workspace: Workspace = await openWorkspace(bounded, directory, env, true);
    // Two registered subfolders can refer to the same repository history; legacy histories remain distinct.
    const records = await workspace.store.list(true);
    if (failed)
      throw new Error("A project history record is unreadable. The previous RAG index was kept.");
    for (const record of records) {
      signal.throwIfAborted();
      const key = `${record.id}:${record.worktree}`;
      if (stores.has(key)) continue;
      stores.add(key);
      const disk = await workspace.store.readEvents(record.id);
      if (failed)
        throw new Error("A project transcript is unreadable. The previous RAG index was kept.");
      add({
        source: {
          version: 1,
          kind: "conversation",
          runId: record.id,
          conversation: "worker",
          title: `${record.agent} / ${record.id}`,
          agent: record.agent,
          project: directory,
        },
        events: mergeRagEvents(
          disk,
          projectLive.filter((event) => event.runId === record.id),
        ),
      });
    }
  }
}
