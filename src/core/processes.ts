import { execFile } from "node:child_process";

/** Process checks used for leftover detection and `stop`. */
export interface Processes {
  isAlive(pid: number): boolean;
  /** Whether any process in the group still exists. */
  groupAlive(pgid: number): boolean;
  /** The command line `ps` reports for `pid`, or undefined if it is gone. */
  commandLine(pid: number): Promise<string | undefined>;
  signalGroup(pgid: number, signal: NodeJS.Signals): void;
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
