import {
  DEFAULT_PROMPT_TEMPLATES,
  type PromptFields,
  type PromptId,
  type PromptSource,
  renderPrompt,
  validatePromptTemplate,
} from "../bridge/index.js";

export const promptLabels: Record<PromptId, string> = {
  operatingContract: "Operating Contract",
  handoffSummary: "Handoff summary",
  handoffTurn: "Handoff first prompt",
  workerUpdates: "Worker updates",
};

export const promptDescriptions: Record<PromptId, string> = {
  operatingContract:
    "Injected with each user message in the Code60 orchestration chat to set its role and boundaries.",
  handoffSummary:
    "Summarizes an ended run for a fresh agent session when its ACP session cannot be restored.",
  handoffTurn: "The first prompt of a handoff session: the summary and the user's new message.",
  workerUpdates:
    "Sent automatically to the orchestration chat when its workers' turns end or fail, between its own turns.",
};

export const sourceLabels: Record<PromptSource, string> = {
  database: "Saved edit",
  config: "config.json",
  "built-in": "Built-in",
};

const sampleSummaryFields: PromptFields<"handoffSummary"> = {
  status: "interrupted",
  turns: "2",
  agent: "claude",
  branch: "code60/20260105-101500-a1b2c3",
  base: "4dee43ac5e38990ace20be2067009e4221747caf",
  worktree: "/projects/app.worktrees/20260105-101500-a1b2c3",
  reason: "the owning process is gone",
  prompts: "- Add input validation to the signup form\n- Also cover the error messages in tests",
  messages: "I added validation for the email and password fields.",
  toolCalls: "- Edit src/signup.ts (edit, completed)\n- Run npm test (execute, failed)",
};

/**
 * Fixed example values for previews; they never come from real runs. The handoff turn's summary
 * is rendered from the given summary template, so it follows edits to that template.
 */
function sampleFields(summaryTemplate: string): { [Id in PromptId]: PromptFields<Id> } {
  const usable = validatePromptTemplate("handoffSummary", summaryTemplate) === undefined;
  return {
    operatingContract: {},
    handoffSummary: sampleSummaryFields,
    handoffTurn: {
      summary: renderPrompt(
        "handoffSummary",
        usable ? summaryTemplate : DEFAULT_PROMPT_TEMPLATES.handoffSummary,
        sampleSummaryFields,
      ),
      message: "Please finish the failing test.",
    },
    workerUpdates: {
      updates:
        "- Worker 20260105-101500-a1b2c3 (claude): idle after turn 1 (end_turn)\n  Reply excerpt: I added validation for the email and password fields.",
    },
  };
}

export type PromptPreview = { ok: true; text: string } | { ok: false; error: string };

export function previewPrompt(
  id: PromptId,
  template: string,
  summaryTemplate: string = DEFAULT_PROMPT_TEMPLATES.handoffSummary,
): PromptPreview {
  const problem = validatePromptTemplate(id, template);
  if (problem) return { ok: false, error: `This template ${problem}.` };
  // The field maps differ per ID; validation above guarantees every placeholder has a value.
  return { ok: true, text: renderPrompt(id, template, sampleFields(summaryTemplate)[id] as never) };
}

/** Replaces the selection with a merge field and returns the new text and cursor position. */
export function insertField(
  text: string,
  start: number,
  end: number,
  field: string,
): { text: string; cursor: number } {
  const from = Math.max(0, Math.min(start, end, text.length));
  const to = Math.min(text.length, Math.max(start, end));
  const token = `{{${field}}}`;
  return { text: text.slice(0, from) + token + text.slice(to), cursor: from + token.length };
}

export type PromptDrafts = Partial<Record<PromptId, string>>;

/** The text shown in the editor: the unsaved draft, or the effective template. */
export const draftText = (drafts: PromptDrafts, id: PromptId, effective: string) =>
  drafts[id] ?? effective;

export const isDirty = (drafts: PromptDrafts, id: PromptId, effective: string) =>
  drafts[id] !== undefined && drafts[id] !== effective;
