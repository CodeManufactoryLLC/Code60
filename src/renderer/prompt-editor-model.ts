import {
  assembleOperatingContract,
  CHAT_TITLE_GUARDRAIL,
  DEFAULT_PROMPT_TEMPLATES,
  type EditablePromptCatalogEntry,
  type InternalPromptId,
  OPERATING_CONTRACT_CLAUSE_IDS,
  PROMPT_CATALOG,
  type PromptFields,
  type PromptId,
  type PromptSource,
  type PromptTemplate,
  type PromptTemplateState,
  type PromptTemplates,
  type ReadOnlyPromptCatalogEntry,
  renderEpisodicMemoryPrompt,
  renderPrompt,
  SEARCH_OVERVIEW_GUARDRAIL,
  validatePromptTemplate,
} from "../bridge/index.js";

export type PromptCatalogFilter = "all" | "editable" | "readonly";

interface EditablePromptItem extends EditablePromptCatalogEntry {
  template: PromptTemplate;
  source: PromptSource;
  fallback: PromptTemplate;
  fallbackSource: Exclude<PromptSource, "database">;
}

export type PromptCatalogItem = EditablePromptItem | ReadOnlyPromptCatalogEntry;

export const sourceLabels: Record<PromptSource, string> = {
  database: "Saved edit",
  config: "config.json",
  "built-in": "Built-in",
};

/** Combines the full 44-prompt static catalog with live state for the 10 editable templates. */
export function buildPromptCatalogItems(
  prompts: readonly PromptTemplateState[],
): PromptCatalogItem[] {
  const byId = new Map<PromptId, PromptTemplateState>(prompts.map((entry) => [entry.id, entry]));
  return PROMPT_CATALOG.map((entry): PromptCatalogItem => {
    if (!entry.editable) return entry;
    const live = byId.get(entry.id);
    if (live) {
      return {
        ...entry,
        template: live.template,
        source: live.source,
        fallback: live.fallback,
        fallbackSource: live.fallbackSource,
      };
    }
    const fallback = DEFAULT_PROMPT_TEMPLATES[entry.id];
    return {
      ...entry,
      template: fallback,
      source: "built-in",
      fallback,
      fallbackSource: "built-in",
    };
  });
}

export function filterPromptCatalog(
  items: readonly PromptCatalogItem[],
  query: string,
  mode: PromptCatalogFilter,
): PromptCatalogItem[] {
  const normalized = query.trim().toLowerCase();
  return items.filter((item) => {
    if (mode === "editable" && !item.editable) return false;
    if (mode === "readonly" && item.editable) return false;
    if (!normalized) return true;
    const haystack =
      `${item.id} ${item.label} ${item.domain} ${item.scope} ${item.description}`.toLowerCase();
    return haystack.includes(normalized);
  });
}

const sampleSummaryFields: PromptFields<"handoff.summary"> = {
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

const sampleChatTitleConversation = JSON.stringify({
  user: "Add input validation to the signup form",
  assistant: "I added email and password validation with tests.",
});

const sampleSearchPayload = JSON.stringify({
  query: "how does handoff recovery work",
  results: [
    {
      id: "1",
      kind: "file",
      title: "src/core/recovery.ts",
      text: "Builds a deterministic, bounded handoff from saved run events.",
    },
  ],
});

const sampleEpisodicEvents =
  '{"type":"prompt","turn":1,"text":"Prefer strict schema validation for config files."}';

/**
 * Fixed example values for previews; they never come from real runs. The handoff turn's summary
 * is rendered from the given summary template, so it follows edits to that template.
 */
function sampleFields(summaryTemplate: string): { [Id in PromptId]: PromptFields<Id> } {
  const usable = validatePromptTemplate("handoff.summary", summaryTemplate) === undefined;
  return {
    "contract.operating": {},
    "handoff.summary": sampleSummaryFields,
    "handoff.first-turn": {
      summary: renderPrompt(
        "handoff.summary",
        usable ? summaryTemplate : DEFAULT_PROMPT_TEMPLATES["handoff.summary"],
        sampleSummaryFields,
      ),
      message: "Please finish the failing test.",
    },
    "worker.updates.project": {
      updates:
        "- Worker 20260105-101500-a1b2c3 (claude): idle after turn 1 (end_turn)\n  Reply excerpt: I added validation for the email and password fields.",
    },
    "plan.accepted.project": {
      planId: "11111111-2222-4333-8444-555555555555",
    },
    "task.continue": {},
    "review.conflict-revision.project": {
      conflicts: '"src/signup.ts": modified on disk',
      project: '"/projects/app"',
    },
    "utility.chat-title": {},
    "utility.search-overview": {},
    "memory.episodic-instructions": {},
  };
}

export type PromptPreview = { ok: true; text: string } | { ok: false; error: string };

export function previewPrompt(
  id: PromptId,
  template: PromptTemplate,
  summaryTemplate: string = DEFAULT_PROMPT_TEMPLATES["handoff.summary"],
): PromptPreview {
  const problem = validatePromptTemplate(id, template);
  if (problem) return { ok: false, error: `This template ${problem}.` };
  if (typeof template !== "string") return { ok: true, text: assembleOperatingContract(template) };
  if (id === "utility.chat-title") {
    return {
      ok: true,
      text: `${template} ${CHAT_TITLE_GUARDRAIL}\n${sampleChatTitleConversation}`,
    };
  }
  if (id === "utility.search-overview") {
    return {
      ok: true,
      text: [template, SEARCH_OVERVIEW_GUARDRAIL, "Search data (JSON):", sampleSearchPayload].join(
        "\n\n",
      ),
    };
  }
  if (id === "memory.episodic-instructions") {
    return {
      ok: true,
      text: renderEpisodicMemoryPrompt(template, sampleEpisodicEvents, 1, 1),
    };
  }
  // The field maps differ per ID; validation above guarantees every placeholder has a value.
  return {
    ok: true,
    text: renderPrompt(id, template, sampleFields(summaryTemplate)[id] as never),
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

export function defaultSelectedPromptId(
  items: readonly PromptCatalogItem[],
  prompts: readonly PromptTemplateState[],
): InternalPromptId | undefined {
  return prompts[0]?.id ?? items[0]?.id;
}
