import { useId, useMemo, useRef, useState } from "react";
import {
  type InternalPromptId,
  OPERATING_CONTRACT_CLAUSE_IDS,
  OPERATING_CONTRACT_CLAUSES,
  operatingContractClausePromptId,
  PROMPT_DOMAINS,
  type PromptDomain,
  type PromptId,
  type PromptTemplate,
  type PromptTemplateState,
} from "../bridge/index.js";
import { Button as AppButton } from "./carbon/button.js";
import { Select as CarbonSelect, TextInput as CarbonTextInput } from "./carbon/fields.js";
import { Textarea as CarbonTextArea } from "./carbon/textarea.js";
import { Icon } from "./icons.js";
import { PageTitle } from "./page-title.js";
import {
  buildPromptCatalogItems,
  defaultSelectedPromptId,
  draftText,
  filterPromptCatalog,
  insertField,
  isDirty,
  type PromptCatalogFilter,
  type PromptDrafts,
  previewPrompt,
  sourceLabels,
} from "./prompt-editor-model.js";

function initialExpandedDomains(): Record<PromptDomain, boolean> {
  return {
    contract: true,
    handoff: true,
    context: false,
    task: true,
    worker: true,
    plan: true,
    review: true,
    memory: true,
    utility: true,
    tactic: false,
    command: false,
  };
}

export function PromptEditorPage({
  prompts,
  busy,
  onSave,
  onReset,
}: {
  prompts: readonly PromptTemplateState[];
  busy: boolean;
  onSave(id: PromptId, template: PromptTemplate): Promise<boolean>;
  onReset(id: PromptId): Promise<boolean>;
}) {
  const id = useId();
  const catalog = useMemo(() => buildPromptCatalogItems(prompts), [prompts]);
  const [selectedId, setSelectedId] = useState<InternalPromptId | undefined>(() =>
    defaultSelectedPromptId(catalog, prompts),
  );
  const [drafts, setDrafts] = useState<PromptDrafts>({});
  const [expanded, setExpanded] = useState<Record<PromptDomain, boolean>>(initialExpandedDomains);
  const [filterQuery, setFilterQuery] = useState("");
  const [filterMode, setFilterMode] = useState<PromptCatalogFilter>("all");
  const [previewVisible, setPreviewVisible] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const visibleItems = useMemo(
    () => filterPromptCatalog(catalog, filterQuery, filterMode),
    [catalog, filterQuery, filterMode],
  );
  const selected =
    catalog.find((entry) => entry.id === selectedId) ?? visibleItems[0] ?? catalog[0];
  if (!selected) return null;

  const filtering = filterQuery.trim().length > 0 || filterMode !== "all";
  const editableSelected = selected.editable ? selected : undefined;
  const text = editableSelected
    ? draftText(drafts, editableSelected.id, editableSelected.template)
    : undefined;
  const dirty = editableSelected
    ? isDirty(drafts, editableSelected.id, editableSelected.template)
    : false;
  const summary = catalog.find(
    (entry): entry is Extract<typeof entry, { editable: true }> =>
      entry.editable && entry.id === "handoff.summary",
  );
  const summaryDraft = summary ? draftText(drafts, summary.id, summary.template) : undefined;
  // An invalid summary draft cannot be saved, so the turn preview falls back to the effective one.
  const summaryText =
    typeof summaryDraft === "string" && previewPrompt("handoff.summary", summaryDraft).ok
      ? summaryDraft
      : typeof summary?.template === "string"
        ? summary.template
        : undefined;
  const preview =
    editableSelected && text !== undefined
      ? previewPrompt(editableSelected.id, text, summaryText)
      : undefined;

  const setDraft = (value: PromptTemplate | undefined) => {
    if (!editableSelected) return;
    setDrafts((current) => {
      const next = { ...current };
      if (value === undefined) delete next[editableSelected.id];
      else if (editableSelected.id === "contract.operating" && typeof value !== "string")
        next["contract.operating"] = value;
      else if (editableSelected.id !== "contract.operating" && typeof value === "string")
        next[editableSelected.id] = value;
      return next;
    });
  };

  const insert = (field: string) => {
    if (typeof text !== "string") return;
    const element = input.current;
    const result = insertField(
      text,
      element?.selectionStart ?? text.length,
      element?.selectionEnd ?? text.length,
      field,
    );
    setDraft(result.text);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(result.cursor, result.cursor);
    });
  };

  const copyId = async (value: string) => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopiedId(value);
      setTimeout(() => setCopiedId((current) => (current === value ? null : current)), 1500);
    } catch {
      /* Clipboard may be unavailable in restricted contexts. */
    }
  };

  const toggleDomain = (domain: PromptDomain) => {
    setExpanded((current) => ({ ...current, [domain]: !current[domain] }));
  };

  const restores = editableSelected ? sourceLabels[editableSelected.fallbackSource] : "";

  return (
    <main className="prompt-editor" aria-labelledby={`${id}-title`}>
      <div className="table-controls">
        <PageTitle page="prompts" className="table-title" id={`${id}-title`} />
      </div>
      <div className="prompt-editor-body">
        <nav className="prompt-editor-list" aria-label="Prompt templates">
          <div className="prompt-editor-filter">
            <CarbonTextInput
              id={`${id}-filter`}
              labelText="Filter prompts"
              hideLabel
              placeholder="Filter by ID or name…"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
            />
            <CarbonSelect
              id={`${id}-mode`}
              labelText="Visibility"
              hideLabel
              value={filterMode}
              onChange={(event) => setFilterMode(event.target.value as PromptCatalogFilter)}
            >
              <option value="all">All ({catalog.length})</option>
              <option value="editable">
                Editable ({catalog.filter((entry) => entry.editable).length})
              </option>
              <option value="readonly">
                Read-only ({catalog.filter((entry) => !entry.editable).length})
              </option>
            </CarbonSelect>
          </div>
          {visibleItems.length === 0 ? (
            <p className="prompt-editor-status">No prompts match this filter.</p>
          ) : (
            PROMPT_DOMAINS.map((domain) => {
              const items = visibleItems.filter((entry) => entry.domain === domain.id);
              if (items.length === 0) return null;
              const open = filtering || expanded[domain.id];
              return (
                <div className="prompt-domain-group" key={domain.id}>
                  <AppButton
                    type="button"
                    className="prompt-system-toggle"
                    variant="quiet"
                    aria-expanded={open}
                    aria-controls={`${id}-domain-${domain.id}`}
                    onClick={() => toggleDomain(domain.id)}
                  >
                    <Icon name={open ? "chevron--down" : "chevron--right"} />
                    <span>{domain.label}</span>
                  </AppButton>
                  <div
                    className="prompt-system-list"
                    id={`${id}-domain-${domain.id}`}
                    hidden={!open}
                  >
                    {items.map((entry) => {
                      const changed = entry.editable && isDirty(drafts, entry.id, entry.template);
                      return (
                        <AppButton
                          key={entry.id}
                          variant="quiet"
                          type="button"
                          aria-current={entry.id === selected.id ? "true" : undefined}
                          onClick={() => {
                            setSelectedId(entry.id);
                            setPreviewVisible(false);
                          }}
                        >
                          <span className="prompt-editor-name">{entry.label}</span>
                          <code className="prompt-editor-id">{entry.id}</code>
                          {changed && <span className="prompt-editor-source">Unsaved changes</span>}
                          {!entry.editable && (
                            <span className="prompt-editor-source">Read-only</span>
                          )}
                        </AppButton>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </nav>
        <section className="prompt-editor-main" aria-labelledby={`${id}-name`}>
          <h2 id={`${id}-name`}>{selected.label}</h2>
          <div className="prompt-editor-meta">
            <code className="prompt-editor-id-badge">{selected.id}</code>
            <AppButton type="button" variant="quiet" onClick={() => void copyId(selected.id)}>
              {copiedId === selected.id ? "Copied" : "Copy ID"}
            </AppButton>
            <span className="prompt-editor-badge">{selected.scope}</span>
            <span className="prompt-editor-badge">
              {selected.editable ? "Editable" : "Read-only"}
            </span>
          </div>
          <p className="muted">{selected.description}</p>
          {editableSelected && text !== undefined && preview ? (
            <>
              <p className="prompt-editor-status" role="status">
                {editableSelected.source !== "built-in" &&
                  `Source: ${sourceLabels[editableSelected.source]}.`}
                {dirty ? " Unsaved changes." : ""}
              </p>
              <div className="prompt-editor-view-toggle">
                <AppButton
                  type="button"
                  aria-controls={`${id}-template-view`}
                  onClick={() => setPreviewVisible((current) => !current)}
                >
                  {previewVisible ? "Edit template" : "Preview"}
                </AppButton>
              </div>
              {previewVisible ? (
                <section
                  className="prompt-editor-preview-view"
                  id={`${id}-template-view`}
                  aria-labelledby={`${id}-preview-title`}
                >
                  <h3 className="field-label" id={`${id}-preview-title`}>
                    {editableSelected.id === "contract.operating"
                      ? "Assembled Operating Contract"
                      : "Preview with sample values"}
                  </h3>
                  {!preview.ok && (
                    <p className="prompt-editor-problem" role="status">
                      {preview.error}
                    </p>
                  )}
                  <pre className="prompt-editor-preview">
                    {preview.ok ? preview.text : "Fix the template to see a preview."}
                  </pre>
                </section>
              ) : (
                <div className="prompt-editor-template-editor" id={`${id}-template-view`}>
                  {editableSelected.fields.length > 0 && (
                    <div className="prompt-editor-fields">
                      <label className="field-label" htmlFor={`${id}-fields`}>
                        Insert merge field
                      </label>
                      <CarbonSelect
                        id={`${id}-fields`}
                        value=""
                        disabled={busy}
                        onChange={(event) => {
                          if (event.target.value) insert(event.target.value);
                        }}
                      >
                        <option value="" disabled>
                          Choose a merge field…
                        </option>
                        {editableSelected.fields.map((field) => (
                          <option key={field} value={field}>
                            {`{{${field}}}`}
                          </option>
                        ))}
                      </CarbonSelect>
                    </div>
                  )}
                  {typeof text !== "string" ? (
                    <div className="prompt-editor-clauses">
                      {OPERATING_CONTRACT_CLAUSE_IDS.map((key) => (
                        <div className="prompt-editor-clause" key={key}>
                          <div className="prompt-editor-clause-header">
                            <label className="field-label" htmlFor={`${id}-clause-${key}`}>
                              {OPERATING_CONTRACT_CLAUSES[key]}
                            </label>
                            <code className="prompt-editor-id">
                              {operatingContractClausePromptId(key)}
                            </code>
                          </div>
                          <div
                            className="prompt-editor-input"
                            data-invalid={preview.ok ? undefined : "true"}
                          >
                            <CarbonTextArea
                              id={`${id}-clause-${key}`}
                              value={text[key]}
                              disabled={busy}
                              spellCheck={false}
                              aria-invalid={!preview.ok}
                              aria-describedby={`${id}-problem`}
                              onChange={(event) => setDraft({ ...text, [key]: event.target.value })}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <label className="field-label" htmlFor={`${id}-template`}>
                        Template
                      </label>
                      <div
                        className="prompt-editor-input"
                        data-invalid={preview.ok ? undefined : "true"}
                      >
                        <CarbonTextArea
                          id={`${id}-template`}
                          ref={input}
                          value={text}
                          disabled={busy}
                          spellCheck={false}
                          aria-invalid={!preview.ok}
                          aria-describedby={`${id}-problem`}
                          onChange={(event) => setDraft(event.target.value)}
                        />
                      </div>
                    </>
                  )}
                  <p className="prompt-editor-problem" id={`${id}-problem`} aria-live="polite">
                    {preview.ok ? "" : preview.error}
                  </p>
                </div>
              )}
              <div className="workflow-actions">
                <AppButton
                  variant="primary"
                  disabled={busy || !dirty || !preview.ok}
                  onClick={async () => {
                    if (await onSave(editableSelected.id, text)) setDraft(undefined);
                  }}
                >
                  Save
                </AppButton>
                <AppButton disabled={busy || !dirty} onClick={() => setDraft(undefined)}>
                  Discard changes
                </AppButton>
                <AppButton
                  variant="quiet"
                  title={`Reset to the ${restores} template`}
                  disabled={busy || editableSelected.source !== "database"}
                  onClick={async () => {
                    if (await onReset(editableSelected.id)) setDraft(undefined);
                  }}
                >
                  Reset to default
                </AppButton>
              </div>
            </>
          ) : (
            <section className="prompt-editor-readonly" aria-label="Read-only prompt text">
              <p className="prompt-editor-readonly-note" role="note">
                Read-only: {selected.editable ? "" : selected.readOnlyReason}
              </p>
              {selected.fields.length > 0 && (
                <p className="prompt-editor-status">
                  Merge fields: {selected.fields.map((field) => `{{${field}}}`).join(", ")}
                </p>
              )}
              <pre className="prompt-editor-preview">
                {selected.editable ? "" : selected.builtInText}
              </pre>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
