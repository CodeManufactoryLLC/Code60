import { z } from "zod";

/** Semantic vocabulary only. Artwork and animation choices belong to the renderer. */
export const ACTIVITY_TYPES = {
  planning: "Planning the next steps.",
  searching: "Searching for information.",
  reading: "Reading information or artifacts.",
  analyzing: "Analyzing information to understand it.",
  comparing: "Comparing alternatives or results.",
  writing: "Composing a user-facing response.",
  editing: "Modifying artifacts.",
  summarizing: "Summarizing information or results.",
  delegating: "Assigning work to worker agents.",
  communicating: "Exchanging information with worker agents.",
  waiting_for_workers: "Waiting for worker agents to provide results.",
  executing: "Running commands or code.",
  testing: "Running tests.",
  verifying: "Checking evidence against requirements.",
  uploading: "Transferring data to another destination.",
  downloading: "Transferring data from another source.",
  working: "Working without a more specific activity description.",
} as const;
export type ActivityType = keyof typeof ACTIVITY_TYPES;
export const ACTIVITY_LIFETIME_MS = 120_000;
export const ACTIVITY_MESSAGE_MS = 2_000;
const ACTIVITY_TOOLS = ["code60_get_activity_context", "code60_report_activity"] as const;
export type ActivityTool = (typeof ACTIVITY_TOOLS)[number];
export function isActivityTool(name: string): name is ActivityTool {
  return (ACTIVITY_TOOLS as readonly string[]).includes(name);
}

export interface ActivityDeclaration {
  activityType: ActivityType;
  label: string;
  expiresAt: number;
}
export type ActivityState =
  | ActivityType
  | "connecting"
  | "responding"
  | "preparing"
  | "deleting"
  | "moving"
  | "retrieving"
  | "dispatching"
  | "sending"
  | "receiving"
  | "waiting_for_approval"
  | "stopping"
  | "idle"
  | "finished"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "interrupted";
export interface ActivitySnapshot {
  state: ActivityState;
  label: string;
  source: "host" | "observed" | "declared";
  declaration: ActivityDeclaration | null;
  otherOperations: number;
  workerCount: number;
  active: boolean;
  urgent: boolean;
}
export interface ActivityAcknowledgment {
  sequence: number;
  expiresAt: number | null;
}

/** Construct schemas after contracts/index enables CSP-safe Zod mode. */
export function parseActivityReport(value: unknown) {
  const shared = {
    scope: z.string().min(1).max(128),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  };
  const activityType = z.custom<ActivityType>(
    (value) => typeof value === "string" && Object.hasOwn(ACTIVITY_TYPES, value),
    "Unsupported activity type; call code60_get_activity_context",
  );
  const result = z
    .discriminatedUnion("operation", [
      z.strictObject({ ...shared, operation: z.literal("clear") }),
      z.strictObject({
        ...shared,
        operation: z.literal("set"),
        activityType,
        label: z
          .string()
          .min(1)
          .max(160)
          .refine(
            (text) => text.trim().length > 0 && !/[\p{Cc}\p{Cf}]/u.test(text),
            "Activity label must be plain text on one line",
          ),
      }),
    ])
    .safeParse(value, { jitless: true });
  if (!result.success) {
    if (result.error.issues.some((issue) => issue.path.includes("activityType")))
      throw new Error("Unsupported activity type; call code60_get_activity_context");
    throw new Error(
      "Invalid activity report: check scope, sequence, operation and label (1–160 plain-text characters)",
    );
  }
  return result.data;
}
export function parseActivityContextArgs(value: unknown): void {
  if (!z.strictObject({}).safeParse(value, { jitless: true }).success)
    throw new Error("Activity context takes no arguments");
}
