import { execFile } from "node:child_process";
import { type NativeProcessIdentity, nativeIdentity, ownedJob } from "../platform/index.js";

/** Process checks used for leftover detection and `stop`. */
export interface Processes {
  isAlive(pid: number): boolean;
  /** Whether any process in the group still exists. */
  groupAlive(pgid: number): boolean;
  /** The command line `ps` reports for `pid`, or undefined if it is gone. */
  commandLine(pid: number): Promise<string | undefined>;
  signalGroup(pgid: number, signal: NodeJS.Signals): void;
  identity?(pid: number): Promise<NativeProcessIdentity | null>;
  ownerAlive?(pid: number, identity?: NativeProcessIdentity): Promise<boolean>;
  agentAlive?(pid: number, identity?: NativeProcessIdentity): Promise<boolean>;
  stopOwned?(pid: number, identity?: NativeProcessIdentity): Promise<void>;
}

function probe(target: number): boolean {
  try {
    process.kill(target, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function createProcesses(): Processes {
  if (process.platform === "win32") {
    return {
      isAlive: (pid) => pid > 0 && probe(pid),
      groupAlive: (pid) => pid > 0 && probe(pid),
      commandLine: async () => undefined,
      signalGroup() {
        throw new Error("Windows requires verified owned-job termination");
      },
      identity: nativeIdentity,
      async ownerAlive(pid, expected) {
        try {
          const live = await nativeIdentity(pid);
          if (live === null) return false;
          return (
            expected === undefined ||
            (live.createdAt === expected.createdAt && live.owner === expected.owner)
          );
        } catch {
          return true;
        } // Inaccessible does not mean gone.
      },
      async agentAlive(pid, expected) {
        if (!expected?.job) return true; // Legacy/unknown metadata cannot authorize a new writer.
        try {
          return (await ownedJob("status", pid, expected)) !== "gone";
        } catch {
          return true;
        } // PID reuse/access denial must not permit discard or continuation.
      },
      async stopOwned(pid, expected) {
        if (!expected?.job)
          throw new Error("Native process/job identity is missing; not stopping the agent");
        if ((await ownedJob("stop", pid, expected)) !== "gone")
          throw new Error("The owned Windows job did not stop");
      },
    };
  }
  return {
    isAlive: (pid) => pid > 0 && probe(pid),
    groupAlive: (pgid) => pgid > 0 && probe(-pgid),
    commandLine(pid) {
      return new Promise((resolve) => {
        execFile(
          "ps",
          ["-ww", "-o", "command=", "-p", String(pid)],
          { timeout: 5_000, encoding: "utf8" },
          (error, stdout) => {
            const line = stdout.trim();
            resolve(error !== null || line === "" ? undefined : line);
          },
        );
      });
    },
    signalGroup(pgid, signal) {
      try {
        process.kill(-pgid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    },
  };
}

export function recordedAgentAlive(
  processes: Processes,
  record: { agentPid?: number | undefined; agentIdentity?: NativeProcessIdentity | undefined },
): Promise<boolean> {
  if (record.agentPid === undefined) return Promise.resolve(false);
  return processes.agentAlive
    ? processes.agentAlive(record.agentPid, record.agentIdentity)
    : Promise.resolve(processes.groupAlive(record.agentPid));
}
