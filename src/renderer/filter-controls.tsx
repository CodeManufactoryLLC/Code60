import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  editableFilter,
  type FilterField,
  type FilterLibrary,
  filterIdentity,
  filterProblem,
  operators,
  type SavedFilter,
} from "./saved-filters.js";
import { type ColumnFilter, filterLabels } from "./table-view.js";
import { useTicker } from "./ticker.js";

export function FilterControls({
  fields,
  library,
  error,
  onChange,
  preview,
}: {
  fields: FilterField[];
  library: FilterLibrary;
  error: string;
  onChange(value: FilterLibrary): void;
  preview(filter: SavedFilter, now: number): number;
}) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const now = useTicker(open, 30000);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<SavedFilter>();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const entry = library.definitions.find((item) => filterIdentity(item).id === selected);
  const active = library.definitions.find((item) => filterIdentity(item).id === library.active);
  const problem = draft ? filterProblem(draft, fields) : "";
  const fresh = (): SavedFilter => ({
    version: 1,
    id: crypto.randomUUID(),
    name: "",
    mode: "all",
    conditions: fields[0]
      ? [
          {
            id: crypto.randomUUID(),
            column: fields[0].key,
            kind: fields[0].kind,
            op: fields[0].kind === "text" ? "contains" : "eq",
            value: "",
          },
        ]
      : [],
  });
  const close = () => {
    setOpen(false);
    setDraft(undefined);
    trigger.current?.focus();
  };
  const save = () => {
    if (!draft || problem) return;
    const value = { ...draft, name: draft.name.trim() };
    onChange({
      ...library,
      definitions: [
        ...library.definitions.filter((item) => filterIdentity(item).id !== value.id),
        value,
      ],
    });
    setSelected(value.id);
    setDraft(undefined);
  };
  return (
    <>
      <button
        type="button"
        ref={trigger}
        onClick={() => {
          setOpen(true);
          setSelected(library.active ?? "");
        }}
      >
        <span
          className="filter-trigger-label"
          title={active ? filterIdentity(active).name : undefined}
        >
          Filters{active ? `: ${filterIdentity(active).name}` : ""}
        </span>
      </button>
      {library.active && (
        <button type="button" onClick={() => onChange({ ...library, active: null })}>
          Unapply filter
        </button>
      )}
      {createPortal(
        <dialog
          ref={dialog}
          className="filter-dialog setup-dialog"
          aria-labelledby={titleId}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <header className="modal-heading">
            <h2 id={titleId}>Filters</h2>
            <button type="button" onClick={close}>
              Close
            </button>
          </header>
          <div className="filter-content">
            {error && (
              <div role="alert">
                <p>{error}</p>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ version: 1, definitions: [], active: null });
                    setDraft(undefined);
                  }}
                >
                  Reset saved filters
                </button>
              </div>
            )}
            <div className="filter-library">
              <label>
                Definition
                <select
                  aria-label="Filter definition"
                  value={selected}
                  onChange={(event) => {
                    setSelected(event.target.value);
                    setDraft(undefined);
                  }}
                >
                  <option value="">Choose a filter</option>
                  {library.definitions.map((item, i) => {
                    const identity = filterIdentity(item);
                    return (
                      <option
                        key={identity.id ?? `invalid-${i}`}
                        value={identity.id ?? `invalid-${i}`}
                      >
                        {identity.name}
                        {identity.id === library.active ? " (applied)" : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
              <button
                type="button"
                disabled={!!error}
                onClick={() => {
                  setDraft(fresh());
                  setSelected("");
                }}
              >
                New filter
              </button>
            </div>
            {selected &&
              !draft &&
              (() => {
                const item = entry ?? library.definitions[Number(selected.replace("invalid-", ""))];
                const issue = filterProblem(item, fields);
                const value = item as SavedFilter;
                return (
                  <section aria-label="Filter details">
                    {issue ? (
                      <p role="alert">Incompatible filter: {issue}</p>
                    ) : (
                      <>
                        <h3>{value.name}</h3>
                        <p>{value.mode === "all" ? "Match all" : "Match any"}</p>
                        <ul>
                          {value.conditions.map((rule) => (
                            <li key={rule.id}>
                              {fields.find((field) => field.key === rule.column)?.title}{" "}
                              {filterLabels[rule.op].toLowerCase()} {rule.value}
                            </li>
                          ))}
                        </ul>
                        <p role="status">{preview(value, now)} matching rows</p>
                      </>
                    )}
                    <div className="button-group">
                      <button
                        type="button"
                        disabled={!!issue || !!error}
                        onClick={() => onChange({ ...library, active: value.id })}
                      >
                        Apply filter
                      </button>
                      <button
                        type="button"
                        disabled={!editableFilter(item) || !!error}
                        onClick={() => setDraft(structuredClone(value))}
                      >
                        Edit filter
                      </button>
                      <button
                        type="button"
                        disabled={!!error}
                        onClick={() => {
                          onChange({
                            ...library,
                            definitions: library.definitions.filter(
                              (candidate) => candidate !== item,
                            ),
                            active:
                              filterIdentity(item).id === library.active ? null : library.active,
                          });
                          setSelected("");
                        }}
                      >
                        Delete filter
                      </button>
                    </div>
                  </section>
                );
              })()}
            {draft && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  save();
                }}
              >
                <label>
                  Name
                  <input
                    aria-label="Filter name"
                    value={draft.name}
                    required
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                </label>
                <label>
                  Conditions
                  <select
                    value={draft.mode}
                    onChange={(event) =>
                      setDraft({ ...draft, mode: event.target.value as "all" | "any" })
                    }
                  >
                    <option value="all">Match all</option>
                    <option value="any">Match any</option>
                  </select>
                </label>
                <div className="filter-rules">
                  {draft.conditions.map((rule, index) => {
                    const change = (value: typeof rule) =>
                      setDraft({
                        ...draft,
                        conditions: draft.conditions.map((item, i) => (i === index ? value : item)),
                      });
                    return (
                      <div className="filter-rule" key={rule.id}>
                        <label>
                          Column
                          <select
                            value={
                              fields.some(
                                (field) => field.key === rule.column && field.kind === rule.kind,
                              )
                                ? rule.column
                                : "incompatible"
                            }
                            onChange={(event) => {
                              const field = fields.find(
                                (field) => field.key === event.target.value,
                              );
                              if (field)
                                change({
                                  id: rule.id,
                                  column: field.key,
                                  kind: field.kind,
                                  op: field.kind === "text" ? "contains" : "eq",
                                  value: "",
                                });
                            }}
                          >
                            {!fields.some(
                              (field) => field.key === rule.column && field.kind === rule.kind,
                            ) && (
                              <option value="incompatible" disabled>
                                {rule.column} (incompatible)
                              </option>
                            )}
                            {fields.map((field) => (
                              <option key={field.key} value={field.key}>
                                {field.title}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Comparison
                          <select
                            value={rule.op}
                            onChange={(event) =>
                              change({ ...rule, op: event.target.value as ColumnFilter["op"] })
                            }
                          >
                            {!operators(rule.kind).includes(rule.op) && (
                              <option value={rule.op} disabled>
                                {rule.op} (unsupported)
                              </option>
                            )}
                            {operators(rule.kind).map((op) => (
                              <option key={op} value={op}>
                                {filterLabels[op]}
                              </option>
                            ))}
                          </select>
                        </label>
                        {rule.op !== "empty" && rule.op !== "present" && (
                          <label>
                            Value
                            <input
                              aria-label={`Condition ${index + 1} value`}
                              type={
                                rule.kind === "number" ||
                                rule.op === "recent" ||
                                rule.op === "older"
                                  ? "number"
                                  : rule.kind === "date"
                                    ? "datetime-local"
                                    : "text"
                              }
                              step="any"
                              value={rule.value}
                              onChange={(event) => change({ ...rule, value: event.target.value })}
                            />
                          </label>
                        )}
                        <button
                          type="button"
                          aria-label={`Remove condition ${index + 1}`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              conditions: draft.conditions.filter((_, i) => i !== index),
                            })
                          }
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setDraft({ ...draft, conditions: [...draft.conditions, ...fresh().conditions] })
                  }
                >
                  Add condition
                </button>
                <p role="status">{problem || `${preview(draft, now)} matching rows`}</p>
                <div className="button-group">
                  <button type="submit" className="primary" disabled={!!problem || !!error}>
                    Save filter
                  </button>
                  <button type="button" onClick={() => setDraft(undefined)}>
                    Cancel edit
                  </button>
                </div>
              </form>
            )}
          </div>
        </dialog>,
        document.querySelector(".app") ?? document.body,
      )}
    </>
  );
}
