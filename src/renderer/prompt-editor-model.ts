import {
  assembleOperatingContract,
  DEFAULT_PROMPT_TEMPLATES,
  OPERATING_CONTRACT_CLAUSE_IDS,
  type PromptFields,
  type PromptId,
  type PromptSource,
  type PromptTemplate,
  type PromptTemplateState,
  type PromptTemplates,
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
  template: PromptTemplate,
  summaryTemplate: string = DEFAULT_PROMPT_TEMPLATES.handoffSummary,
): PromptPreview {
  const problem = validatePromptTemplate(id, template);
  if (problem) return { ok: false, error: `This template ${problem}.` };
  // The field maps differ per ID; validation above guarantees every placeholder has a value.
  return {
    ok: true,
    text:
      typeof template === "string"
        ? renderPrompt(id, template, sampleFields(summaryTemplate)[id] as never)
        : assembleOperatingContract(template),
  };
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

export type PromptDrafts = Partial<PromptTemplates>;

/** The text shown in the editor: the unsaved draft, or the effective template. */
export const draftText = <Id extends PromptId>(
  drafts: PromptDrafts,
  id: Id,
  effective: PromptTemplates[Id],
): PromptTemplates[Id] => drafts[id] ?? effective;

export function isDirty(drafts: PromptDrafts, id: PromptId, effective: PromptTemplate): boolean {
  const draft = drafts[id];
  if (draft === undefined) return false;
  if (typeof draft === "string" || typeof effective === "string") return draft !== effective;
  return OPERATING_CONTRACT_CLAUSE_IDS.some((key) => draft[key] !== effective[key]);
}

function sameTemplate(a: PromptTemplate, b: PromptTemplate): boolean {
  if (typeof a === "string" || typeof b === "string") return a === b;
  return OPERATING_CONTRACT_CLAUSE_IDS.every((key) => a[key] === b[key]);
}

export const templateBody = (template: PromptTemplate): string =>
  typeof template === "string" ? template : assembleOperatingContract(template);

export function matchesPrompt(id: PromptId, query: string): boolean {
  return `${promptLabels[id]} ${promptDescriptions[id]}`
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}

export const fieldDescriptions: Record<string, string> = {
  status: "Saved run status",
  turns: "Number of completed turns",
  agent: "Provider identifier",
  branch: "Run branch, or none",
  base: "Base commit, or none",
  worktree: "Run working directory",
  reason: "Recorded handoff reason, or none",
  prompts: "Saved user prompts, one per line",
  messages: "Saved agent messages, one per line",
  toolCalls: "Latest tool-call titles, kinds and states",
  summary: "Rendered handoff summary",
  message: "New user message (required)",
  updates: "Worker states and reply excerpts (required)",
};

export function fieldExample(id: PromptId, field: string): string {
  return (
    (sampleFields(DEFAULT_PROMPT_TEMPLATES.handoffSummary)[id] as Record<string, string>)[field] ??
    ""
  );
}

export interface PromptProblem {
  clause?: (typeof OPERATING_CONTRACT_CLAUSE_IDS)[number];
  start: number;
  end: number;
  line: number;
  column: number;
  message: string;
}

/** Location hints supplement the authoritative shared validator; they never change validity. */
export function locateProblem(id: PromptId, template: PromptTemplate): PromptProblem | undefined {
  const error = validatePromptTemplate(id, template);
  if (!error) return undefined;
  let clause =
    typeof template === "string"
      ? undefined
      : OPERATING_CONTRACT_CLAUSE_IDS.find((key) =>
          validatePromptTemplate(
            "operatingContract",
            Object.fromEntries(
              OPERATING_CONTRACT_CLAUSE_IDS.map((clause) => [
                clause,
                clause === key ? template[key] : "x",
              ]),
            ),
          ),
        );
  if (typeof template !== "string" && !clause && error.includes("at most"))
    clause = OPERATING_CONTRACT_CLAUSE_IDS.at(-1);
  const text =
    typeof template === "string" ? template : clause ? template[clause] : templateBody(template);
  const unknown = /unknown merge field '([^']+)'/.exec(error)?.[1];
  let start = 0;
  let end = 0;
  let correction = "Enter nonempty text.";
  if (unknown) {
    const token = [...text.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g)].find(
      (match) => match[1] === unknown,
    );
    start = token?.index ?? 0;
    end = start + (token?.[0].length ?? 0);
    correction =
      id === "operatingContract"
        ? "Remove this merge field; clauses use plain text."
        : "Replace this with an allowed merge field from Insert merge field.";
  } else if (error.includes("malformed")) {
    const valid = [...text.matchAll(/\{\{\s*[A-Za-z][A-Za-z0-9]*\s*\}\}/g)];
    start = text.indexOf("{{");
    while (start >= 0 && valid.some((match) => match.index === start))
      start = text.indexOf("{{", start + 2);
    start = Math.max(0, start);
    end = Math.min(text.length, start + 2);
    correction =
      id === "operatingContract"
        ? "Remove the opening braces; clauses use plain text."
        : "Use {{name}} with an allowed field name and both closing braces.";
  } else if (error.includes("must include")) {
    start = end = text.length;
    correction = `Insert ${/must include (.*)/.exec(error)?.[1] ?? "the required field"}.`;
  } else if (error.includes("at most")) {
    start = end = text.length;
    correction = "Shorten the complete template to 8,000 characters, including clause separators.";
  }
  const prefix = text.slice(0, start).split("\n");
  return {
    ...(clause ? { clause } : {}),
    start,
    end,
    line: prefix.length,
    column: (prefix.at(-1)?.length ?? 0) + 1,
    message: `This template ${error}. ${correction}`,
  };
}

interface DraftRecord {
  baseline: PromptTemplateState;
  value: PromptTemplate;
  past: PromptTemplate[];
  future: PromptTemplate[];
  revision: number;
  awaiting?: PromptTemplateState;
}

/** Owned by the application view, indexed by database path; never persisted or sent to an agent. */
export class PromptDraftSession {
  readonly records = new Map<PromptId, DraftRecord>();
  read(state: PromptTemplateState): PromptTemplate {
    return this.records.get(state.id)?.value ?? state.template;
  }
  edit(state: PromptTemplateState, value: PromptTemplate): void {
    const record = this.records.get(state.id) ?? {
      baseline: state,
      value: state.template,
      past: [],
      future: [],
      revision: 0,
    };
    if (sameTemplate(record.value, value)) return;
    record.past.push(record.value);
    if (record.past.length > 100) record.past.shift();
    record.value = value;
    record.future = [];
    record.revision++;
    this.records.set(state.id, record);
  }
  dirty(state: PromptTemplateState): boolean {
    const record = this.records.get(state.id);
    return !!record && !sameTemplate(record.value, record.baseline.template);
  }
  get pending(): boolean {
    return [...this.records.values()].some(
      (record) => !sameTemplate(record.value, record.baseline.template),
    );
  }
  conflict(state: PromptTemplateState): boolean {
    const record = this.records.get(state.id);
    if (!record) return false;
    const matches =
      record.baseline.source === state.source &&
      sameTemplate(record.baseline.template, state.template);
    if (matches) {
      delete record.awaiting;
      return false;
    }
    // Main broadcasts coalesce for 40ms. A successful write can precede its snapshot.
    return !(
      record.awaiting?.source === state.source &&
      sameTemplate(record.awaiting.template, state.template)
    );
  }
  failed(id: PromptId): void {
    const record = this.records.get(id);
    if (record) delete record.awaiting;
  }
  undo(id: PromptId, redo = false): void {
    const record = this.records.get(id);
    if (!record) return;
    const from = redo ? record.future : record.past;
    const to = redo ? record.past : record.future;
    const value = from.pop();
    if (value === undefined) return;
    to.push(record.value);
    record.value = value;
    record.revision++;
  }
  rebase(state: PromptTemplateState): void {
    const record = this.records.get(state.id);
    if (record) {
      record.baseline = state;
      record.revision++;
    }
  }
  discard(id: PromptId): void {
    this.records.delete(id);
  }
  reset(state: PromptTemplateState, revision: number | undefined): void {
    const record = this.records.get(state.id);
    const restored = { ...state, template: state.fallback, source: state.fallbackSource };
    if (record && record.revision !== revision) {
      record.awaiting = state;
      record.baseline = restored;
      return;
    }
    this.records.set(state.id, {
      baseline: restored,
      value: restored.template,
      past: [],
      future: [],
      revision: (revision ?? 0) + 1,
      awaiting: state,
    });
  }
  saved(id: PromptId, revision: number | undefined, value: PromptTemplate): void {
    const record = this.records.get(id);
    if (!record) return;
    record.awaiting = record.baseline;
    record.baseline = { ...record.baseline, template: value, source: "database" };
    if (record.revision === revision) record.value = value;
  }
}
