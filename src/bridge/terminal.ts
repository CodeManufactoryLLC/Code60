import { z } from "zod";
import { parseValue, runIdSchema } from "../contracts/index.js";

z.config({ jitless: true });

export const TERMINAL_LIMITS = {
  maxSessions: 16,
  maxWriteBytes: 64 * 1024,
  minCols: 2,
  maxCols: 500,
  minRows: 1,
  maxRows: 200,
} as const;

const terminalDimensionsSchema = {
  cols: z.number().int().min(TERMINAL_LIMITS.minCols).max(TERMINAL_LIMITS.maxCols),
  rows: z.number().int().min(TERMINAL_LIMITS.minRows).max(TERMINAL_LIMITS.maxRows),
};

const terminalTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("project-worker"),
    runId: runIdSchema,
    projectId: z.string().uuid().optional(),
    databaseEpoch: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    kind: z.literal("project"),
    projectId: z.string().uuid().optional(),
    databaseEpoch: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    kind: z.literal("relay-worker"),
    runId: runIdSchema,
    conversationId: z.string().uuid().optional(),
  }),
  z.strictObject({
    kind: z.literal("relay"),
    conversationId: z.string().uuid().optional(),
  }),
]);

const terminalOpenRequestSchema = z.strictObject({
  target: terminalTargetSchema,
  ...terminalDimensionsSchema,
});

const terminalWriteRequestSchema = z.strictObject({
  id: z.string().uuid(),
  data: z
    .string()
    .min(1)
    .refine(
      (value) => new TextEncoder().encode(value).byteLength <= TERMINAL_LIMITS.maxWriteBytes,
      {
        message: "Terminal input exceeds maximum write size",
      },
    ),
});

const terminalResizeRequestSchema = z.strictObject({
  id: z.string().uuid(),
  ...terminalDimensionsSchema,
});

const terminalCloseRequestSchema = z.strictObject({
  id: z.string().uuid(),
});

export type TerminalTarget = z.infer<typeof terminalTargetSchema>;
export type TerminalOpenRequest = z.infer<typeof terminalOpenRequestSchema>;
export type TerminalWriteRequest = z.infer<typeof terminalWriteRequestSchema>;
export type TerminalResizeRequest = z.infer<typeof terminalResizeRequestSchema>;
export type TerminalCloseRequest = z.infer<typeof terminalCloseRequestSchema>;

export interface TerminalSessionInfo {
  id: string;
  cwd: string;
  displayCwd?: string;
  shell: string;
  pid: number;
  label: string;
  project: string | null;
  displayProject?: string | null;
  projectId: string | null;
  targetKind: TerminalTarget["kind"];
  runId: string | null;
  startedAt: string;
}

export interface TerminalSummary {
  id: string;
  cwd: string;
  displayCwd?: string;
  shell: string;
  pid: number;
  label: string;
  project: string | null;
  displayProject?: string | null;
  projectId: string | null;
  targetKind: TerminalTarget["kind"];
  runId: string | null;
  startedAt: string;
}

/**
 * Abbreviate a POSIX path consistently with bash `PROMPT_DIRTRIM` behavior:
 * replaces `$HOME` with `~` and keeps the trailing `keep` directory segments.
 */
export function abbreviateTerminalPath(path: string, home?: string | null, keep = 2): string {
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const normalizedHome = home && home.length > 1 ? home.replace(/\/+$/, "") : home;
  if (normalizedHome && normalizedHome !== "/") {
    if (normalized === normalizedHome) return "~";
    if (normalized.startsWith(`${normalizedHome}/`)) {
      const rest = normalized.slice(normalizedHome.length + 1).split("/");
      if (rest.length <= keep) return `~/${rest.join("/")}`;
      return `~/…/${rest.slice(-keep).join("/")}`;
    }
  }
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= keep + 1) return normalized;
  return `…/${parts.slice(-keep).join("/")}`;
}

export type TerminalEvent =
  | { id: string; type: "data"; data: string }
  | { id: string; type: "exit"; code: number | null; signal: string | null };

export const parseTerminalOpen = (value: unknown): TerminalOpenRequest =>
  parseValue(terminalOpenRequestSchema, value);

export const parseTerminalWrite = (value: unknown): TerminalWriteRequest =>
  parseValue(terminalWriteRequestSchema, value);

export const parseTerminalResize = (value: unknown): TerminalResizeRequest =>
  parseValue(terminalResizeRequestSchema, value);

export const parseTerminalClose = (value: unknown): TerminalCloseRequest =>
  parseValue(terminalCloseRequestSchema, value);
