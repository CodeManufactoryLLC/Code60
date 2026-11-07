import type { ChangedFile, Git } from "../git/index.js";
import { type Clock, sleep } from "./clock.js";
import { type Processes, recordedAgentAlive } from "./processes.js";
import { assertRunId, type RecordStore } from "./records.js";
import { ACTIVE_STATUSES, RefusedError, type RunRecord } from "./types.js";

export interface CommandDeps {
  git: Git;
  store: RecordStore;
  clock: Clock;
  processes: Processes;
}

export interface ListedRun {
  record: RunRecord;
  /** The agent's process group still exists. */
  agentAlive: boolean;
  /** The live command line of the agent, when it is still running. */
  agentCommandLine?: string;
}

/** Marks active runs whose owning process is gone as `interrupted`. Returns how many changed. */
export async function markInterrupted(
  deps: Pick<CommandDeps, "store" | "clock" | "processes">,
  records: RunRecord[],
): Promise<number> {
  let changed = 0;
  for (const record of records) {
    if (!ACTIVE_STATUSES.has(record.status)) continue;
    const ownerAlive = deps.processes.ownerAlive
      ? await deps.processes.ownerAlive(record.ownerPid, record.ownerIdentity)
      : deps.processes.isAlive(record.ownerPid);
    if (ownerAlive) continue;
    const reason = `the owning process (PID ${record.ownerPid}) is gone`;
    record.status = "interrupted";
    record.reason = reason;
    const at = deps.clock.now().toISOString();
    await deps.store.save(record);
    await deps.store.appendEvent({
      runId: record.id,
      at,
      type: "status",
      status: "interrupted",
      reason,
    });
    changed += 1;
  }
  return changed;
}

export async function listRuns(deps: CommandDeps): Promise<ListedRun[]> {
  const records = await deps.store.list();
  await markInterrupted(deps, records);
  return Promise.all(
    records.map(async (record) => {
      const agentAlive =
        record.agentPid !== undefined &&
        !ACTIVE_STATUSES.has(record.status) &&
        (await recordedAgentAlive(deps.processes, record));
      const listed: ListedRun = { record, agentAlive };
      if (agentAlive) {
        const line = await deps.processes.commandLine(record.agentPid as number);
        if (line !== undefined) listed.agentCommandLine = line;
      }
      return listed;
    }),
  );
}

async function readRun(deps: CommandDeps, id: string): Promise<RunRecord> {
  assertRunId(id);
  const record = await deps.store.read(id);
  await markInterrupted(deps, [record]);
  return record;
}

export async function diffRun(deps: CommandDeps, id: string): Promise<string> {
  const record = await readRun(deps, id);
  if (record.discardedAt !== undefined) throw new RefusedError(`run ${id} was discarded`);
  if (record.base === null) {
    throw new RefusedError(
      `run ${id} ran directly in ${record.worktree} without a worktree, so there is no separate diff; review the changes in that directory`,
    );
  }
  return deps.git.diff(record.worktree, record.base);
}

export interface DiscardResult {
  discarded: boolean;
  files: ChangedFile[];
  record: RunRecord;
}

/** Removes a run's worktree and branch after `confirm` approves the files that will be lost. */
export async function discardRun(
  deps: CommandDeps,
  repoDir: string,
  id: string,
  confirm: (files: readonly ChangedFile[], record: RunRecord) => Promise<boolean>,
): Promise<DiscardResult> {
  const record = await readRun(deps, id);
  if (record.discardedAt !== undefined) throw new RefusedError(`run ${id} was already discarded`);
  if (record.base === null || record.branch === null) {
    throw new RefusedError(
      `run ${id} ran directly in ${record.worktree} without a worktree; there is no worktree or branch to discard`,
    );
  }
  const { base, branch } = record;
  if (ACTIVE_STATUSES.has(record.status)) {
    throw new RefusedError(`run ${id} is ${record.status}; finish or cancel it before discarding`);
  }
  if (await recordedAgentAlive(deps.processes, record)) {
    throw new RefusedError(
      `the agent for run ${id} may still be running (process group ${record.agentPid}); stop it first with 'code60 stop ${id}'`,
    );
  }
  const files = await deps.git.changedFiles(record.worktree, base).catch(() => []);
  if (!(await confirm(files, record))) return { discarded: false, files, record };
  await deps.git.removeWorktree(repoDir, record.worktree, branch);
  record.discardedAt = deps.clock.now().toISOString();
  await deps.store.save(record);
  return { discarded: true, files, record };
}

export interface StopResult {
  stopped: boolean;
  pid?: number;
  message: string;
}

const STOP_GRACE_MS = 5_000;
const POLL_MS = 50;

/** Kills the leftover agent of an ended run, after confirming the PID was not reused. */
export async function stopRun(deps: CommandDeps, id: string): Promise<StopResult> {
  const record = await readRun(deps, id);
  if (ACTIVE_STATUSES.has(record.status)) {
    throw new RefusedError(
      `run ${id} is ${record.status} and owned by a live process (PID ${record.ownerPid}); stop it from there`,
    );
  }
  const pid = record.agentPid;
  if (pid === undefined || !(await recordedAgentAlive(deps.processes, record))) {
    return { stopped: false, message: `no agent process is running for run ${id}` };
  }
  if (deps.processes.stopOwned) {
    try {
      await deps.processes.stopOwned(pid, record.agentIdentity);
    } catch {
      throw new RefusedError(
        `cannot verify native process/job identity for process ${pid}; not stopping the agent for run ${id}`,
      );
    }
    return { stopped: true, pid, message: `stopped the agent for run ${id} (owned Windows job)` };
  }
  const live = await deps.processes.commandLine(pid);
  if (
    live === undefined ||
    record.agentCommandLine === undefined ||
    live !== record.agentCommandLine
  ) {
    throw new RefusedError(
      `cannot confirm that process ${pid} is the agent started for run ${id}; not stopping it` +
        `\n  recorded: ${record.agentCommandLine ?? "(unknown)"}\n  live:     ${live ?? "(process group leader is gone)"}`,
    );
  }
  deps.processes.signalGroup(pid, "SIGTERM");
  for (
    let waited = 0;
    deps.processes.groupAlive(pid) && waited < STOP_GRACE_MS;
    waited += POLL_MS
  ) {
    await sleep(deps.clock, POLL_MS);
  }
  if (deps.processes.groupAlive(pid)) deps.processes.signalGroup(pid, "SIGKILL");
  return { stopped: true, pid, message: `stopped the agent for run ${id} (process group ${pid})` };
}
