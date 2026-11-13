import { z } from "zod";
import { parseValue } from "../contracts/index.js";
import type { FileDirectory, FilePreview, PollState } from "./index.js";

const path = z
  .string()
  .max(4096)
  .refine(
    (value) =>
      value === "" ||
      (!value.includes("\\") &&
        !value.includes("\0") &&
        value.split("/").every((part) => part !== "" && part !== "." && part !== "..")),
    "Expected a relative file path without traversal",
  );
const schema = z.strictObject({
  subscriptionId: z.string().uuid(),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  active: z.boolean(),
  directories: z
    .array(path)
    .min(1)
    .max(64)
    .refine(
      (paths) => paths.includes("") && new Set(paths).size === paths.length,
      "Invalid folders",
    ),
  preview: path.refine((value) => value !== "", "Expected a file").nullable(),
});
export type RelayFileContext = z.infer<typeof schema>;
export interface RelayFileSnapshot {
  context: RelayFileContext;
  directories: FileDirectory[];
  preview: FilePreview | null;
}
export interface RelayFileDetails {
  files?: RelayFileSnapshot | null;
  filePolling?: PollState | null;
}
export const parseRelayFileContext = (value: unknown): RelayFileContext =>
  parseValue(schema, value);
