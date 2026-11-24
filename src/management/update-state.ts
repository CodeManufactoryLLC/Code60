import { join } from "node:path";
import {
  type FileIdentity,
  installationDirectory,
  installationSnapshot,
  writeInstallationFile,
} from "../platform/index.js";
import type { InstallationRecord } from "./install-state.js";

const phases = [
  "checking",
  "acquiring",
  "prepared",
  "stopping",
  "stopped",
  "publishing",
  "activated",
  "repairing",
  "ready",
  "aborted",
] as const;
type UpdatePhase = (typeof phases)[number];
export interface UpdateRecord {
  schema: 1;
  installationId: string;
  attempt: string;
  previous: { generation: string; version: string; sha256: string };
  candidate: { generation: string | null; version: string; sha256: string } | null;
  phase: UpdatePhase;
  outcome: "running" | "failed" | "interrupted" | "complete";
}
export interface UpdateSnapshot {
  value: UpdateRecord;
  identity: FileIdentity;
}
const uuid = (value: unknown) => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const version = (value: unknown) =>
  typeof value === "string" && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value);

function validate(record: InstallationRecord, value: UpdateRecord) {
  if (
    value?.schema !== 1 ||
    value.installationId !== record.id ||
    !uuid(value.attempt) ||
    !value.previous ||
    !uuid(value.previous.generation) ||
    !version(value.previous.version) ||
    !digest(value.previous.sha256) ||
    !phases.includes(value.phase) ||
    !["running", "failed", "interrupted", "complete"].includes(value.outcome) ||
    (value.candidate !== null &&
      (!value.candidate ||
        !version(value.candidate.version) ||
        !digest(value.candidate.sha256) ||
        (value.candidate.generation !== null && !uuid(value.candidate.generation)))) ||
    (value.phase !== "checking" && value.phase !== "aborted" && !value.candidate) ||
    (["prepared", "stopping", "stopped", "publishing", "activated", "repairing", "ready"].includes(
      value.phase,
    ) &&
      !uuid(value.candidate?.generation)) ||
    (value.phase === "ready" || value.phase === "aborted") !== (value.outcome === "complete")
  )
    throw Error(
      "Invalid update progress; preserve the record and inspect installation recovery guidance",
    );
}

export async function readUpdateProgress(
  record: InstallationRecord,
): Promise<UpdateSnapshot | null> {
  await installationDirectory(record.root, false, true);
  const file = await installationSnapshot(join(record.root, "update.json"), 16_384, true);
  if (!file) return null;
  const value = JSON.parse(file.text) as UpdateRecord;
  validate(record, value);
  return { value, identity: file.identity };
}

// The caller owns the separate setup lock for the entire update/recovery. CAS
// additionally rejects outside edits without overwriting their evidence.
export async function writeUpdateProgress(
  record: InstallationRecord,
  value: UpdateRecord,
  previous: UpdateSnapshot | null,
): Promise<UpdateSnapshot> {
  validate(record, value);
  const identity = await writeInstallationFile(
    join(record.root, "update.json"),
    `${JSON.stringify(value)}\n`,
    previous?.identity ?? null,
  );
  return { value: structuredClone(value), identity };
}
