import { useId, useRef, useState } from "react";
import {
  OPERATING_CONTRACT_CLAUSE_IDS,
  OPERATING_CONTRACT_CLAUSES,
  type PromptId,
  type PromptTemplate,
  type PromptTemplateState,
} from "../bridge/index.js";
import { Icon } from "./icons.js";
import {
  draftText,
  insertField,
  isDirty,
  type PromptDrafts,
  previewPrompt,
  promptDescriptions,
  promptLabels,
  sourceLabels,
} from "./prompt-editor-model.js";
import { TableControlGroup } from "./table-controls.js";

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
  const [selectedId, setSelectedId] = useState<PromptId | undefined>(prompts[0]?.id);
  const [drafts, setDrafts] = useState<PromptDrafts>({});
  const [systemExpanded, setSystemExpanded] = useState(true);
  const [previewVisible, setPreviewVisible] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const selected = prompts.find((entry) => entry.id === selectedId) ?? prompts[0];
  if (!selected) return null;

  const text = draftText(drafts, selected.id, selected.template);
  const dirty = isDirty(drafts, selected.id, selected.template);
  const summary = prompts.find((entry) => entry.id === "handoffSummary");
  const summaryDraft = summary ? draftText(drafts, summary.id, summary.template) : undefined;
  // An invalid summary draft cannot be saved, so the turn preview falls back to the effective one.
  const summaryText =
    typeof summaryDraft === "string" && previewPrompt("handoffSummary", summaryDraft).ok
      ? summaryDraft
      : typeof summary?.template === "string"
        ? summary.template
        : undefined;
  const preview = previewPrompt(selected.id, text, summaryText);
  const setDraft = (value: PromptTemplate | undefined) =>
    setDrafts((current) => {
      const next = { ...current };
      if (value === undefined) delete next[selected.id];
      else if (selected.id === "operatingContract" && typeof value !== "string")
        next.operatingContract = value;
      else if (selected.id !== "operatingContract" && typeof value === "string")
        next[selected.id] = value;
      return next;
    });
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
  const restores = sourceLabels[selected.fallbackSource];

  return (
    <main className="prompt-editor" aria-labelledby={`${id}-title`}>
      <div className="table-controls">
        <h1 className="table-title" id={`${id}-title`}>
          Prompt Builder
        </h1>
        <TableControlGroup label="Template actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Save"
            data-active={dirty && preview.ok ? "true" : undefined}
            disabled={busy || !dirty || !preview.ok}
            onClick={async () => {
              if (await onSave(selected.id, text)) setDraft(undefined);
            }}
          >
            <Icon name="checkmark" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Discard changes"
            disabled={busy || !dirty}
            onClick={() => setDraft(undefined)}
          >
            <Icon name="close" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Reset to default"
            data-tooltip={`Reset to the ${restores} template`}
            disabled={busy || selected.source !== "database"}
            onClick={async () => {
              if (await onReset(selected.id)) setDraft(undefined);
            }}
          >
            <Icon name="renew" />
          </button>
        </TableControlGroup>
      </div>
      <div className="prompt-editor-body">
        <nav className="prompt-editor-list" aria-label="Prompt templates">
          <button
            type="button"
            className="prompt-system-toggle"
            aria-expanded={systemExpanded}
            aria-controls={`${id}-system`}
            onClick={() => setSystemExpanded((current) => !current)}
          >
            <Icon name={systemExpanded ? "chevron--down" : "chevron--right"} />
            System
          </button>
          <div className="prompt-system-list" id={`${id}-system`} hidden={!systemExpanded}>
            {prompts.map((entry) => {
              const changed = isDirty(drafts, entry.id, entry.template);
              return (
                <button
                  key={entry.id}
                  type="button"
                  aria-current={entry.id === selected.id ? "true" : undefined}
                  onClick={() => setSelectedId(entry.id)}
                >
                  <span className="prompt-editor-name">{promptLabels[entry.id]}</span>
                  {changed && <span className="prompt-editor-source">Unsaved changes</span>}
                </button>
              );
            })}
          </div>
        </nav>
        <section className="prompt-editor-main" aria-labelledby={`${id}-name`}>
          <h2 id={`${id}-name`}>{promptLabels[selected.id]}</h2>
          <p className="muted">{promptDescriptions[selected.id]}</p>
          <p className="prompt-editor-status" role="status">
            {selected.source !== "built-in" && `Source: ${sourceLabels[selected.source]}.`}
            {dirty ? " Unsaved changes." : ""}
          </p>
          <div className="prompt-editor-view-toggle">
            <button
              type="button"
              aria-controls={`${id}-template-view`}
              onClick={() => setPreviewVisible((current) => !current)}
            >
              {previewVisible ? "Edit template" : "Preview"}
            </button>
          </div>
          {previewVisible ? (
            <section
              className="prompt-editor-preview-view"
              id={`${id}-template-view`}
              aria-labelledby={`${id}-preview-title`}
            >
              <h3 className="field-label" id={`${id}-preview-title`}>
                {selected.id === "operatingContract"
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
              {selected.fields.length > 0 && (
                <div className="prompt-editor-fields">
                  <label className="field-label" htmlFor={`${id}-fields`}>
                    Insert merge field
                  </label>
                  <select
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
                    {selected.fields.map((field) => (
                      <option key={field} value={field}>
                        {`{{${field}}}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {typeof text !== "string" ? (
                <div className="prompt-editor-clauses">
                  {OPERATING_CONTRACT_CLAUSE_IDS.map((key) => (
                    <div className="prompt-editor-clause" key={key}>
                      <label className="field-label" htmlFor={`${id}-clause-${key}`}>
                        {OPERATING_CONTRACT_CLAUSES[key]}
                      </label>
                      <div
                        className="prompt-editor-input"
                        data-invalid={preview.ok ? undefined : "true"}
                      >
                        <textarea
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
                    <textarea
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
        </section>
      </div>
    </main>
  );
}
