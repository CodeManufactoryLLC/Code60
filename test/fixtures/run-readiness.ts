import { readFile } from "node:fs/promises";

/** A published run ID can precede creation of its durable record. */
export async function recordedAgentPid(path: string): Promise<number> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  const record: unknown = JSON.parse(text);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Invalid run record");
  }
  if (!("agentPid" in record)) return 0;
  const pid = record.agentPid;
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("Invalid agentPid in run record");
  }
  return pid;
}
