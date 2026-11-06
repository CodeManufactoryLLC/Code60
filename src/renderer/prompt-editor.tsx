import { useId, useRef, useState } from "react";
import {
  MCP_TOOL_CONTRACT_INFO,
  MCP_TOOL_DEFINITIONS,
  type PromptId,
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

export function PromptEditorPage({
  prompts,
  busy,
  onSave,
  onReset,
}: {
  prompts: readonly PromptTemplateState[];
  busy: boolean;
  onSave(id: PromptId, template: string): Promise<boolean>;
  onReset(id: PromptId): Promise<boolean>;
}) {
  const id = useId();
  const [selectedId, setSelectedId] = useState<PromptId | undefined>(prompts[0]?.id);
  const [drafts, setDrafts] = useState<PromptDrafts>({});
  const [systemExpanded, setSystemExpanded] = useState(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const selected = prompts.find((entry) => entry.id === selectedId) ?? prompts[0];
  if (!selected) return null;

  const text = draftText(drafts, selected.id, selected.template);
  const dirty = isDirty(drafts, selected.id, selected.template);
  const summary = prompts.find((entry) => entry.id === "handoffSummary");
  const summaryDraft = summary ? draftText(drafts, summary.id, summary.template) : undefined;
  // An invalid summary draft cannot be saved, so the turn preview falls back to the effective one.
  const summaryText =
    summaryDraft !== undefined && previewPrompt("handoffSummary", summaryDraft).ok
      ? summaryDraft
      : summary?.template;
  const preview = previewPrompt(selected.id, text, summaryText);
  const setDraft = (value: string | undefined) =>
    setDrafts((current) => {
      const next = { ...current };
      if (value === undefined) delete next[selected.id];
      else next[selected.id] = value;
      return next;
    });
  const insert = (field: string) => {
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
          Prompt Editor
        </h1>
        {/* biome-ignore lint/a11y/useSemanticElements: these groups contain page actions, not form fields. */}
        <div
          className="button-group table-control-group"
          role="group"
          aria-label="Template actions"
        >
          <button
            type="button"
            className="primary"
            disabled={busy || !dirty || !preview.ok}
            data-tooltip={
              !dirty ? "No unsaved changes" : !preview.ok ? "Fix the template first" : undefined
            }
            onClick={async () => {
              if (await onSave(selected.id, text)) setDraft(undefined);
            }}
          >
            <Icon name="checkmark" />
            Save
          </button>
          <button
            type="button"
            disabled={busy || !dirty}
            data-tooltip={dirty ? undefined : "No unsaved changes"}
            onClick={() => setDraft(undefined)}
          >
            <Icon name="close" />
            Discard changes
          </button>
          <button
            type="button"
            disabled={busy || selected.source !== "database"}
            data-tooltip={
              selected.source === "database"
                ? `Remove the saved edit and use the ${restores} template`
                : "No saved edit to reset"
            }
            onClick={async () => {
              if (await onReset(selected.id)) setDraft(undefined);
            }}
          >
            <Icon name="renew" />
            Reset to default
          </button>
        </div>
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
          <label className="field-label" htmlFor={`${id}-template`}>
            Template
          </label>
          <div className="prompt-editor-input" data-invalid={preview.ok ? undefined : "true"}>
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
          <p className="prompt-editor-problem" id={`${id}-problem`} aria-live="polite">
            {preview.ok ? "" : preview.error}
          </p>
          <h3 className="field-label" id={`${id}-preview`}>
            Preview with sample values
          </h3>
          {selected.fields.includes("summary") && (
            <p className="muted">
              {"{{summary}}"} is the {promptLabels.handoffSummary} template merged with the same
              sample values, including its unsaved changes.
            </p>
          )}
          <pre className="prompt-editor-preview">
            {preview.ok ? preview.text : "Fix the template to see a preview."}
          </pre>
        </section>
      </div>
      <section className="prompt-editor-mcp" aria-labelledby={`${id}-mcp-title`}>
        <h2 id={`${id}-mcp-title`}>MCP tool descriptions</h2>
        <p className="muted">{MCP_TOOL_CONTRACT_INFO}</p>
        <div className="prompt-editor-mcp-list">
          {MCP_TOOL_DEFINITIONS.map((tool) => (
            <article className="prompt-editor-mcp-tool" key={tool.name}>
              <h3>{tool.name}</h3>
              <p>{tool.description}</p>
              <details>
                <summary>
                  Input contract ({tool.readOnly ? "read-only" : "changes worker state"})
                </summary>
                <pre className="prompt-editor-preview">
                  {JSON.stringify(tool.inputSchema, null, 2)}
                </pre>
              </details>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
