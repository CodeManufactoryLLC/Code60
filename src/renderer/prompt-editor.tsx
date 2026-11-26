import {
  Button,
  CodeSnippet,
  ContentSwitcher,
  Form,
  InlineNotification,
  Search,
  Select,
  SelectItem,
  Switch,
  Tag,
  TextArea,
} from "@carbon/react";
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
import { Icon } from "./icons.js";
import { ControlDescription } from "./overlays.js";
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

const FILTER_MODES: readonly PromptCatalogFilter[] = ["all", "editable", "readonly"];

function initialExpandedDomains(): Record<PromptDomain, boolean> {
  return {
    command: false,
    context: false,
    contract: true,
    handoff: true,
    memory: true,
    plan: true,
    review: true,
    tactic: false,
    task: true,
    utility: true,
    worker: true,
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
  const input = useRef<HTMLTextAreaElement>(null);

  const visibleItems = useMemo(
    () => filterPromptCatalog(catalog, filterQuery, filterMode),
    [catalog, filterQuery, filterMode],
  );
  const editableCount = useMemo(() => catalog.filter((entry) => entry.editable).length, [catalog]);
  const readonlyCount = catalog.length - editableCount;

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

  const toggleDomain = (domain: PromptDomain) => {
    setExpanded((current) => ({ ...current, [domain]: !current[domain] }));
  };

  const clearFilters = () => {
    setFilterQuery("");
    setFilterMode("all");
  };

  const restores = editableSelected ? sourceLabels[editableSelected.fallbackSource] : "";
  const statusAnnouncement = editableSelected
    ? [
        editableSelected.source !== "built-in"
          ? `Source: ${sourceLabels[editableSelected.source]}.`
          : "",
        dirty ? "Unsaved changes." : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  const requiredFieldsHelper =
    editableSelected && editableSelected.requiredFields.length > 0
      ? `Required merge fields: ${editableSelected.requiredFields.map((field) => `{{${field}}}`).join(", ")}`
      : undefined;

  return (
    <main className="prompt-editor internal-prompts-page" aria-labelledby={`${id}-title`}>
      <header className="table-controls">
        <PageTitle page="prompts" className="table-title" id={`${id}-title`} />
        <ControlDescription>
          Inspect all internal prompts by canonical ID and customize editable templates for this
          project.
        </ControlDescription>
      </header>
      <div className="prompt-editor-body">
        <nav className="prompt-editor-list" aria-label="Prompt templates">
          <div className="prompt-editor-filter">
            <Search
              id={`${id}-filter`}
              size="md"
              labelText="Filter prompts"
              placeholder="Filter by ID or name"
              closeButtonLabelText="Clear prompt filter"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              onClear={() => setFilterQuery("")}
            />
            <ContentSwitcher
              size="sm"
              className="prompt-editor-mode-switcher"
              selectedIndex={FILTER_MODES.indexOf(filterMode)}
              onChange={(selection) => {
                const next = selection.name;
                if (next === "all" || next === "editable" || next === "readonly") {
                  setFilterMode(next);
                }
              }}
              aria-label="Prompt access filter"
            >
              <Switch name="all" text={`All (${catalog.length})`} />
              <Switch name="editable" text={`Editable (${editableCount})`} />
              <Switch name="readonly" text={`Read-only (${readonlyCount})`} />
            </ContentSwitcher>
          </div>
          {visibleItems.length === 0 ? (
            <div className="prompt-editor-empty">
              <p>No prompts match this filter.</p>
              <Button type="button" kind="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            PROMPT_DOMAINS.map((domain) => {
              const items = visibleItems
                .filter((entry) => entry.domain === domain.id)
                .toSorted((a, b) => a.label.localeCompare(b.label));
              if (items.length === 0) return null;
              const open = filtering || expanded[domain.id];
              return (
                <div className="prompt-domain-group" key={domain.id}>
                  <Button
                    type="button"
                    kind="ghost"
                    size="sm"
                    className="prompt-system-toggle"
                    aria-expanded={open}
                    aria-controls={`${id}-domain-${domain.id}`}
                    onClick={() => toggleDomain(domain.id)}
                  >
                    <Icon name={open ? "chevron--down" : "chevron--right"} />
                    <span>{domain.label}</span>
                    <span className="prompt-domain-count">{items.length}</span>
                  </Button>
                  <div
                    className="prompt-system-list"
                    id={`${id}-domain-${domain.id}`}
                    hidden={!open}
                  >
                    {items.map((entry) => {
                      const changed = entry.editable && isDirty(drafts, entry.id, entry.template);
                      return (
                        <Button
                          key={entry.id}
                          kind="ghost"
                          size="sm"
                          type="button"
                          className="prompt-editor-item"
                          aria-current={entry.id === selected.id ? "true" : undefined}
                          onClick={() => {
                            setSelectedId(entry.id);
                            setPreviewVisible(false);
                          }}
                        >
                          <span className="prompt-editor-name">{entry.label}</span>
                          <code className="prompt-editor-id">{entry.id}</code>
                          {changed && (
                            <span className="prompt-editor-source prompt-editor-source--dirty">
                              Unsaved changes
                            </span>
                          )}
                          {!entry.editable && (
                            <span className="prompt-editor-source">Read-only</span>
                          )}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </nav>
        <section className="prompt-editor-main" aria-labelledby={`${id}-name`}>
          <header className="prompt-detail-header">
            <h2 id={`${id}-name`}>{selected.label}</h2>
            <div className="prompt-editor-meta">
              <CodeSnippet
                type="inline"
                className="prompt-editor-id-badge"
                feedback="Copied ID"
                aria-label={`Copy prompt ID ${selected.id}`}
              >
                {selected.id}
              </CodeSnippet>
              <Tag size="sm" type={selected.editable ? "teal" : "cool-gray"}>
                {selected.editable ? "Editable" : "Read-only"}
              </Tag>
              <Tag size="sm" type="gray">
                {selected.scope}
              </Tag>
              {editableSelected && editableSelected.source !== "built-in" && (
                <Tag size="sm" type="blue">
                  {`Source: ${sourceLabels[editableSelected.source]}`}
                </Tag>
              )}
              {dirty && (
                <Tag size="sm" type="purple">
                  Unsaved changes
                </Tag>
              )}
            </div>
            <p className="cds--visually-hidden" role="status">
              {statusAnnouncement}
            </p>
            <p className="prompt-editor-description">{selected.description}</p>
          </header>

          {editableSelected && text !== undefined && preview ? (
            <>
              <div className="prompt-editor-view-toggle">
                <ContentSwitcher
                  key={editableSelected.id}
                  size="sm"
                  className="prompt-editor-view-switcher"
                  selectedIndex={previewVisible ? 1 : 0}
                  onChange={(selection) => setPreviewVisible(selection.name === "preview")}
                  aria-label="Template view"
                >
                  <Switch name="edit" text="Edit template" />
                  <Switch name="preview" text="Preview" />
                </ContentSwitcher>
              </div>
              {previewVisible ? (
                <section
                  className="prompt-editor-preview-view"
                  id={`${id}-template-view`}
                  aria-labelledby={`${id}-preview-title`}
                >
                  <h3 className="prompt-editor-section-heading" id={`${id}-preview-title`}>
                    {editableSelected.id === "contract.operating"
                      ? "Assembled Operating Contract"
                      : "Preview with sample values"}
                  </h3>
                  {preview.ok ? (
                    <CodeSnippet
                      key={`${editableSelected.id}-preview`}
                      type="multi"
                      wrapText
                      feedback="Copied preview"
                      aria-label="Copy rendered prompt preview"
                      maxCollapsedNumberOfRows={24}
                    >
                      {preview.text}
                    </CodeSnippet>
                  ) : (
                    <InlineNotification
                      kind="error"
                      lowContrast
                      hideCloseButton
                      title="Template error"
                      subtitle={preview.error}
                    />
                  )}
                </section>
              ) : (
                <Form
                  className="prompt-editor-form"
                  id={`${id}-template-view`}
                  onSubmit={(event) => event.preventDefault()}
                >
                  {editableSelected.fields.length > 0 && (
                    <div className="prompt-editor-merge-field">
                      <Select
                        id={`${id}-fields`}
                        labelText="Insert merge field"
                        helperText={`Available merge fields: ${editableSelected.fields.map((field) => `{{${field}}}`).join(", ")}`}
                        value=""
                        disabled={busy}
                        onChange={(event) => {
                          if (event.target.value) insert(event.target.value);
                        }}
                      >
                        <SelectItem value="" text="Choose a merge field" disabled hidden />
                        {editableSelected.fields.map((field) => (
                          <SelectItem key={field} value={field} text={`{{${field}}}`} />
                        ))}
                      </Select>
                    </div>
                  )}
                  {typeof text !== "string" ? (
                    <div className="prompt-editor-clauses">
                      {OPERATING_CONTRACT_CLAUSE_IDS.map((key) => {
                        const clauseValue = text[key];
                        const clauseInvalid =
                          !preview.ok &&
                          (clauseValue.trim().length === 0 ||
                            clauseValue.includes("{{") ||
                            clauseValue.includes("}}"));
                        return (
                          <TextArea
                            key={key}
                            id={`${id}-clause-${key}`}
                            className="prompt-editor-monospace-textarea"
                            labelText={OPERATING_CONTRACT_CLAUSES[key]}
                            helperText={
                              <code className="prompt-editor-id">
                                {operatingContractClausePromptId(key)}
                              </code>
                            }
                            rows={3}
                            value={clauseValue}
                            disabled={busy}
                            spellCheck={false}
                            invalid={clauseInvalid}
                            invalidText={clauseInvalid ? preview.error : ""}
                            onChange={(event) => setDraft({ ...text, [key]: event.target.value })}
                          />
                        );
                      })}
                      {!preview.ok && (
                        <InlineNotification
                          kind="error"
                          lowContrast
                          hideCloseButton
                          title="Template error"
                          subtitle={preview.error}
                        />
                      )}
                    </div>
                  ) : (
                    <TextArea
                      id={`${id}-template`}
                      ref={input}
                      className="prompt-editor-monospace-textarea"
                      labelText="Template"
                      {...(requiredFieldsHelper ? { helperText: requiredFieldsHelper } : {})}
                      rows={12}
                      value={text}
                      disabled={busy}
                      spellCheck={false}
                      invalid={!preview.ok}
                      invalidText={preview.ok ? "" : preview.error}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                  )}
                </Form>
              )}
              <div className="prompt-editor-actions">
                <Button
                  type="button"
                  kind="danger--ghost"
                  size="md"
                  title={`Reset to the ${restores} template`}
                  disabled={busy || editableSelected.source !== "database"}
                  onClick={async () => {
                    if (await onReset(editableSelected.id)) setDraft(undefined);
                  }}
                >
                  Reset to default
                </Button>
                <Button
                  type="button"
                  kind="secondary"
                  size="md"
                  disabled={busy || !dirty}
                  onClick={() => setDraft(undefined)}
                >
                  Discard changes
                </Button>
                <Button
                  type="button"
                  kind="primary"
                  size="md"
                  disabled={busy || !dirty || !preview.ok}
                  onClick={async () => {
                    if (await onSave(editableSelected.id, text)) setDraft(undefined);
                  }}
                >
                  Save
                </Button>
              </div>
            </>
          ) : (
            <section className="prompt-editor-readonly" aria-label="Read-only prompt text">
              <InlineNotification
                kind="info"
                lowContrast
                hideCloseButton
                title="Read-only prompt"
                subtitle={selected.editable ? "" : selected.readOnlyReason}
                className="prompt-editor-readonly-note"
              />
              {selected.fields.length > 0 && (
                <div className="prompt-editor-readonly-fields">
                  <span className="prompt-editor-fields-heading">Merge fields</span>
                  <div className="prompt-editor-tag-list">
                    {selected.fields.map((field) => (
                      <Tag key={field} size="sm" type="cool-gray">
                        {`{{${field}}}`}
                      </Tag>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <h3 className="prompt-editor-section-heading">Built-in template</h3>
                <CodeSnippet
                  key={`${selected.id}-builtin`}
                  type="multi"
                  wrapText
                  feedback="Copied template"
                  aria-label="Copy built-in prompt template"
                  maxCollapsedNumberOfRows={28}
                >
                  {selected.editable ? "" : selected.builtInText}
                </CodeSnippet>
              </div>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
