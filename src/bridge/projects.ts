import { z } from "zod";
import { parseValue } from "../contracts/index.js";

const projectActionSchema = z.strictObject({
  type: z.enum(["select", "close", "stop-folder"]),
  projectId: z.string().uuid(),
});
export type ProjectAction = z.infer<typeof projectActionSchema>;
export const parseProjectAction = (value: unknown): ProjectAction =>
  parseValue(projectActionSchema, value);

export interface OpenProject {
  id: string;
  path: string;
  active: boolean;
  chatIds: string[];
  workerIds: string[];
  workerSummaries?: import("./index.js").DesktopRun[];
}
