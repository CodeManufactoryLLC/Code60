import { useEffect, useId, useRef, useState } from "react";
import {
  OPERATING_CONTRACT_CLAUSE_IDS,
  OPERATING_CONTRACT_CLAUSES,
  type PromptExpectation,
  type PromptId,
  type PromptTemplate,
  type PromptTemplateState,
} from "../bridge/index.js";
import { Icon } from "./icons.js";
import { PageTitle } from "./page-title.js";
import {
  fieldDescriptions,
  fieldExample,
  insertField,
  locateProblem,
  matchesPrompt,
  PromptDraftSession,
  previewPrompt,
  promptDescriptions,
  promptLabels,
  sourceLabels,
  templateBody,
} from "./prompt-editor-model.js";
import { PromptTextInput } from "./prompt-text-input.js";
import { TableControlGroup } from "./table-controls.js";

export function PromptEditorPage({
  prompts,
  busy,
  onSave,
  onReset,
  session: providedSession,
  onDraftsChanged,
}: {
  prompts: readonly PromptTemplateState[];
  busy: boolean;
  session?: PromptDraftSession;
  onDraftsChanged?(): void;
  onSave(id: PromptId, template: PromptTemplate, expected: PromptExpectation): Promise<boolean>;
  onReset(id: PromptId, expected: PromptExpectation): Promise<boolean>;
}) {
  const id = useId();
  const [localSession] = useState(() => new PromptDraftSession());
  const session = providedSession ?? localSession;
  const [, render] = useState(0);
  const changed = () => {
    render((n) => n + 1);
    onDraftsChanged?.();
  };
  const [selectedId, setSelectedId] = useState<PromptId | undefined>(prompts[0]?.id);
  const [query, setQuery] = useState("");
  const [systemExpanded, setSystemExpanded] = useState(true);
  const [view, setView] = useState("edit");
  const [sideBySide, setSideBySide] = useState(false);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = matchMedia("(max-width: 1000px)");
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [compare, setCompare] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [lines, setLines] = useState(false);
  const [findVisible, setFindVisible] = useState(false);
  const [find, setFind] = useState("");
  const [replacement, setReplacement] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pending, setPending] = useState(false);
  const operation = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const activeInput = useRef<HTMLTextAreaElement | null>(null);
  const selected = prompts.find((entry) => entry.id === selectedId) ?? prompts[0];
  if (!selected) return null;
  const text = session.read(selected);
  const dirty = session.dirty(selected);
  const conflict = session.conflict(selected);
  const record = session.records.get(selected.id);
  const expected = record?.baseline ?? selected;
  const disabled = busy || pending;
  const summary = prompts.find((entry) => entry.id === "handoffSummary");
  const summaryDraft = summary ? session.read(summary) : undefined;
  const summaryText =
    typeof summaryDraft === "string" && previewPrompt("handoffSummary", summaryDraft).ok
      ? summaryDraft
      : typeof summary?.template === "string"
        ? summary.template
        : undefined;
  const preview = previewPrompt(selected.id, text, summaryText);
  const problem = locateProblem(selected.id, text);
  const setDraft = (value: PromptTemplate) => {
    session.edit(selected, value);
    setFeedback("");
    changed();
  };
  const selectRange = (element: HTMLTextAreaElement | null, start: number, end = start) => {
    element?.focus();
    element?.setSelectionRange(start, end);
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
    requestAnimationFrame(() => selectRange(element, result.cursor));
  };
  const undo = (redo = false) => {
    session.undo(selected.id, redo);
    changed();
  };
  const findNext = () => {
    const element =
      activeInput.current ??
      input.current ??
      (document.getElementById(`${id}-clause-role`) as HTMLTextAreaElement | null);
    if (!element || !find) return;
    const start = element.value.indexOf(find, element.selectionEnd);
    const from = start < 0 ? element.value.indexOf(find) : start;
    if (from < 0) {
      setFeedback("No match in the active field.");
      return;
    }
    setFeedback("Match selected in the active field.");
    selectRange(element, from, from + find.length);
  };
  const replace = (all: boolean) => {
    const element = activeInput.current ?? input.current;
    if (!element || !find) {
      setFeedback("Focus a template field, then find a match.");
      return;
    }
    const from = element.selectionStart;
    const to = element.selectionEnd;
    if (!all && element.value.slice(from, to) !== find) {
      findNext();
      return;
    }
    const value = all
      ? element.value.split(find).join(replacement)
      : element.value.slice(0, from) + replacement + element.value.slice(to);
    const clause = OPERATING_CONTRACT_CLAUSE_IDS.find(
      (key) => element.id === `${id}-clause-${key}`,
    );
    if (typeof text === "string") setDraft(value);
    else if (clause) setDraft({ ...text, [clause]: value });
    requestAnimationFrame(() => selectRange(element, all ? 0 : from + replacement.length));
  };
  const save = async (reset = false) => {
    if (operation.current) return;
    operation.current = true;
    setPending(true);
    setFeedback("");
    const target = selected.id;
    const revision = record?.revision;
    try {
      const ok = reset ? await onReset(target, expected) : await onSave(target, text, expected);
      if (ok) {
        if (reset) session.reset(selected, revision);
        else session.saved(target, revision, text);
        changed();
      } else {
        session.failed(target);
        setFeedback(
          reset
            ? "Reset was not completed. Your draft is preserved."
            : "Save failed. Your draft is preserved; resolve the error and try again.",
        );
      }
    } catch {
      session.failed(target);
      setFeedback("The operation failed. Your draft is preserved; try again.");
    } finally {
      operation.current = false;
      setPending(false);
    }
  };
  const split = sideBySide && !narrow;
  const editorVisible = split || view === "edit";
  const previewVisible = split || view === "preview";
  return (
    <main
      className="prompt-editor"
      aria-labelledby={`${id}-title`}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && ["f", "h"].includes(event.key.toLowerCase())) {
          event.preventDefault();
          setFindVisible(true);
          requestAnimationFrame(() => document.getElementById(`${id}-find-input`)?.focus());
        }
      }}
    >
      <div className="table-controls">
        <PageTitle page="prompts" className="table-title" id={`${id}-title`} />
        <TableControlGroup label="Template actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Save"
            data-active={dirty && preview.ok ? "true" : undefined}
            disabled={disabled || !dirty || !preview.ok || conflict}
            onClick={() => void save()}
          >
            <Icon name="checkmark" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Discard changes"
            disabled={disabled || (!dirty && !conflict)}
            onClick={() => {
              session.discard(selected.id);
              setFeedback("Draft discarded. Saved version loaded.");
              changed();
            }}
          >
            <Icon name="close" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Reset to default"
            data-tooltip={`Reset to the ${sourceLabels[selected.fallbackSource]} template`}
            disabled={disabled || selected.source !== "database" || conflict}
            onClick={() => void save(true)}
          >
            <Icon name="renew" />
          </button>
        </TableControlGroup>
      </div>
      <div className="prompt-editor-body">
        <nav className="prompt-editor-list" aria-label="Prompt templates">
          <label htmlFor={`${id}-search`}>Search templates</label>
          <input
            type="search"
            id={`${id}-search`}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSystemExpanded(true);
            }}
          />
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
            {prompts
              .filter((entry) => matchesPrompt(entry.id, query))
              .map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-current={entry.id === selected.id ? "true" : undefined}
                  onClick={() => {
                    setSelectedId(entry.id);
                    activeInput.current = null;
                    setFeedback("");
                  }}
                >
                  <span className="prompt-editor-name">{promptLabels[entry.id]}</span>
                  {session.dirty(entry) && (
                    <span className="prompt-editor-source">Unsaved changes</span>
                  )}
                  {session.conflict(entry) && (
                    <span className="prompt-editor-source">External change</span>
                  )}
                </button>
              ))}
            {!prompts.some((entry) => matchesPrompt(entry.id, query)) && (
              <p role="status">No matching templates.</p>
            )}
          </div>
        </nav>
        <section className="prompt-editor-main" aria-labelledby={`${id}-name`}>
          <h2 id={`${id}-name`}>{promptLabels[selected.id]}</h2>
          <p className="muted">{promptDescriptions[selected.id]}</p>
          <p className="prompt-editor-status" role="status">
            Source: {sourceLabels[selected.source]}. Reset destination:{" "}
            {sourceLabels[selected.fallbackSource]}.{dirty ? " Unsaved changes." : ""}
          </p>
          {conflict && (
            <div className="prompt-editor-conflict" role="alert">
              <p>
                The saved template changed externally. Your draft is preserved. Compare both
                versions before choosing.
              </p>
              <button type="button" disabled={disabled} onClick={() => setCompare(true)}>
                Compare versions
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  session.rebase(selected);
                  changed();
                }}
              >
                Keep draft against latest saved version
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  session.discard(selected.id);
                  changed();
                }}
              >
                Reload saved version and discard draft
              </button>
            </div>
          )}
          <div className="prompt-editor-toolbar">
            <button
              type="button"
              disabled={disabled || !record?.past.length}
              onClick={() => undo()}
            >
              Undo
            </button>
            <button
              type="button"
              disabled={disabled || !record?.future.length}
              onClick={() => undo(true)}
            >
              Redo
            </button>
            <button
              type="button"
              aria-expanded={findVisible}
              aria-controls={`${id}-find`}
              onClick={() => setFindVisible((value) => !value)}
            >
              Find / replace
            </button>
            <label>
              <input
                type="checkbox"
                checked={wrap}
                onChange={(event) => setWrap(event.target.checked)}
              />
              Word wrap
            </label>
            <label>
              <input
                type="checkbox"
                checked={lines}
                onChange={(event) => setLines(event.target.checked)}
              />
              Line numbers
            </label>
            <label>
              <input
                type="checkbox"
                disabled={narrow}
                checked={sideBySide}
                onChange={(event) => setSideBySide(event.target.checked)}
              />
              Side-by-side preview
            </label>
            <button
              type="button"
              aria-expanded={compare}
              aria-controls={`${id}-compare`}
              onClick={() => setCompare((value) => !value)}
            >
              Compare with saved
            </button>
          </div>
          {findVisible && (
            <div className="prompt-editor-find" id={`${id}-find`}>
              <label>
                Find in active field
                <input
                  id={`${id}-find-input`}
                  value={find}
                  onChange={(event) => setFind(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") findNext();
                  }}
                />
              </label>
              <label>
                Replace with
                <input
                  value={replacement}
                  onChange={(event) => setReplacement(event.target.value)}
                />
              </label>
              <button type="button" disabled={!find} onClick={findNext}>
                Find next
              </button>
              <button
                type="button"
                disabled={disabled || !find}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => replace(false)}
              >
                Replace selection
              </button>
              <button type="button" disabled={disabled || !find} onClick={() => replace(true)}>
                Replace all in field
              </button>
            </div>
          )}
          {compare && (
            <section
              className="prompt-editor-comparison"
              id={`${id}-compare`}
              aria-label="Draft comparison"
            >
              <div>
                <h3>Saved version</h3>
                <pre className="prompt-editor-preview">{templateBody(selected.template)}</pre>
              </div>
              <div>
                <h3>Draft</h3>
                <pre className="prompt-editor-preview">{templateBody(text)}</pre>
              </div>
            </section>
          )}
          <div className="prompt-editor-view-toggle" role="tablist" aria-label="Template view">
            {(["edit", "preview"] as const).map((tab, index) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`${id}-${tab}-tab`}
                aria-controls={`${id}-${tab}-panel`}
                aria-selected={view === tab}
                tabIndex={view === tab ? 0 : -1}
                onClick={() => setView(tab)}
                onKeyDown={(event) => {
                  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? "edit"
                        : event.key === "End"
                          ? "preview"
                          : index === 0
                            ? "preview"
                            : "edit";
                    setView(next);
                    document.getElementById(`${id}-${next}-tab`)?.focus();
                  }
                }}
              >
                {tab === "edit" ? "Edit template" : "Preview"}
              </button>
            ))}
          </div>
          <div className="prompt-editor-workspace" data-split={split}>
            <section
              id={`${id}-edit-panel`}
              role="tabpanel"
              aria-labelledby={`${id}-edit-tab`}
              hidden={!editorVisible}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: APG tab panels need a keyboard scrolling destination.
              tabIndex={0}
            >
              {selected.fields.length > 0 && (
                <div className="prompt-editor-fields">
                  <label className="field-label" htmlFor={`${id}-fields`}>
                    Insert merge field
                  </label>
                  <select
                    id={`${id}-fields`}
                    value=""
                    disabled={disabled}
                    onChange={(event) => {
                      if (event.target.value) insert(event.target.value);
                    }}
                  >
                    <option value="" disabled>
                      Choose a merge field…
                    </option>
                    {selected.fields.map((field) => (
                      <option
                        key={field}
                        value={field}
                      >{`{{${field}}} — ${fieldDescriptions[field]}`}</option>
                    ))}
                  </select>
                  <details>
                    <summary>Merge field descriptions and sample values</summary>
                    <dl>
                      {selected.fields.map((field) => (
                        <div key={field}>
                          <dt>{`{{${field}}} — ${fieldDescriptions[field]}`}</dt>
                          <dd>
                            <pre>{fieldExample(selected.id, field)}</pre>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </div>
              )}
              <div className={typeof text === "string" ? undefined : "prompt-editor-clauses"}>
                {(typeof text === "string" ? [undefined] : OPERATING_CONTRACT_CLAUSE_IDS).map(
                  (clause) => (
                    <div
                      className={clause ? "prompt-editor-clause" : "prompt-editor-text"}
                      key={clause ?? "template"}
                    >
                      <PromptTextInput
                        id={clause ? `${id}-clause-${clause}` : `${id}-template`}
                        label={clause ? OPERATING_CONTRACT_CLAUSES[clause] : "Template"}
                        value={typeof text === "string" ? text : clause ? text[clause] : ""}
                        busy={disabled}
                        wrap={wrap}
                        lines={lines}
                        invalid={
                          !!problem && (problem.clause === undefined || problem.clause === clause)
                        }
                        problemId={`${id}-problem`}
                        {...(clause ? {} : { input })}
                        onFocus={(element) => {
                          activeInput.current = element;
                        }}
                        onUndo={undo}
                        onChange={(value) => {
                          if (typeof text === "string") setDraft(value);
                          else if (clause) setDraft({ ...text, [clause]: value });
                        }}
                      />
                    </div>
                  ),
                )}
              </div>
            </section>
            <section
              className="prompt-editor-preview-view"
              id={`${id}-preview-panel`}
              role="tabpanel"
              aria-labelledby={`${id}-preview-tab`}
              hidden={!previewVisible}
              // biome-ignore lint/a11y/noNoninteractiveTabindex: APG tab panels need a keyboard scrolling destination.
              tabIndex={0}
            >
              <h3 className="field-label">
                {selected.id === "operatingContract"
                  ? "Assembled Operating Contract"
                  : "Preview with sample values"}
              </h3>
              <p>Sample data only. Preview never sends an agent request.</p>
              <pre className="prompt-editor-preview">
                {preview.ok ? preview.text : "Fix the template to see a preview."}
              </pre>
            </section>
          </div>
          <div className="prompt-editor-problem" id={`${id}-problem`} aria-live="polite">
            {problem && (
              <>
                <p>{problem.message}</p>
                <button
                  type="button"
                  onClick={() => {
                    setView("edit");
                    requestAnimationFrame(() => {
                      const target = document.getElementById(
                        problem.clause
                          ? `${id}-clause-${problem.clause}`
                          : typeof text === "string"
                            ? `${id}-template`
                            : `${id}-clause-role`,
                      ) as HTMLTextAreaElement | null;
                      selectRange(target, problem.start, problem.end);
                    });
                  }}
                >
                  {problem.clause ? OPERATING_CONTRACT_CLAUSES[problem.clause] : "Template"}, line{" "}
                  {problem.line}, column {problem.column}: Go to problem
                </button>
              </>
            )}
          </div>
          <p aria-live="polite">{feedback}</p>
          <details>
            <summary>Editing help</summary>
            <p>
              Undo: Ctrl/Cmd+Z. Redo: Ctrl/Cmd+Shift+Z or Ctrl+Y. Find and replace applies to the
              last focused field and matches literal, case-sensitive text. Tab leaves the text
              field. Preview uses fixed synthetic samples; handoff previews use a valid summary
              draft. Save and reset affect future uses only. Drafts stay in this window across
              templates, pages and database switches. Reload is blocked while drafts remain; save or
              discard them first. Closing asks before discarding.
            </p>
          </details>
        </section>
      </div>
    </main>
  );
}
