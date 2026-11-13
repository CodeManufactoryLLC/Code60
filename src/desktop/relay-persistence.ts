import type { BigIntStats } from "node:fs";
import { type LogInput, logInputSchema } from "../bridge/index.js";

const identityFields = ["dev", "ino", "size", "mtimeNs", "ctimeNs"] as const;
export function changedJournalFields(previous: BigIntStats, current: BigIntStats) {
  return identityFields.filter((field) => previous[field] !== current[field]);
}

/** Carries only allowlisted metadata, never the original exception or source. */
export class RelayPersistenceError extends Error {
  readonly code: NonNullable<LogInput["errorCode"]>;
  constructor(
    readonly stage: NonNullable<LogInput["persistenceStage"]>,
    readonly failure: NonNullable<LogInput["persistenceFailure"]>,
    cause?: unknown,
    readonly fields: NonNullable<LogInput["changedIdentityFields"]> = [],
  ) {
    super(
      failure === "identity"
        ? "Relay history has an incomplete tail or outside changes. Check storage before continuing."
        : failure === "invalid-frame"
          ? "Relay history has an incomplete tail. Check storage before continuing."
          : "Relay history persistence failed",
    );
    const code = (cause as { code?: unknown } | null)?.code;
    const parsed = logInputSchema.shape.errorCode.safeParse(code);
    this.code = parsed.success ? (parsed.data ?? "UNKNOWN") : "UNKNOWN";
  }
}
