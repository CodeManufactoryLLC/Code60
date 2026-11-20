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
  const pid = record && typeof record === "object" && "agentPid" in record ? record.agentPid : 0;
  return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? pid : 0;
}
