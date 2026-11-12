import type { DesktopRun } from "../bridge/index.js";

/** Run records on disk and explicit detail reads retain the original prompt. */
export function summarizeRun(run: DesktopRun): DesktopRun {
  return { ...run, record: { ...run.record, firstPrompt: "" } };
}
