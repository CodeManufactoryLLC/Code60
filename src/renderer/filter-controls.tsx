import { useId, useRef, useState } from "react";
import { randomId } from "./browser-platform.js";
import { Button as AppButton } from "./carbon/button.js";
import { Select as CarbonSelect, TextInput as CarbonTextInput } from "./carbon/fields.js";
import { Icon } from "./icons.js";
import { Modal } from "./modal.js";
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
  retained = false,
}: {
  fields: FilterField[];
  library: FilterLibrary;
  error: string;
  onChange(value: FilterLibrary): void;
  preview(filter: SavedFilter, now: number): number;
  retained?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const now = useTicker(open, 30000);
  const [selected, setSelected] = useState("");
  const [draft, setDraft] = useState<SavedFilter>();
  const formId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const entry = library.definitions.find((item) => filterIdentity(item).id === selected);
  const active = library.definitions.find((item) => filterIdentity(item).id === library.active);
  const problem = draft ? filterProblem(draft, fields) : "";
  const fresh = (): SavedFilter => ({
    version: 1,
    id: randomId(),
    name: "",
    mode: "all",
    conditions: fields[0]
      ? [
          {
            id: randomId(),
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
      <AppButton
        type="button"
        className="icon-button"
        ref={trigger}
        aria-label={`Filters${active ? `: ${filterIdentity(active).name}` : ""}`}
        data-active={library.active ? "true" : undefined}
        onClick={() => {
          setOpen(true);
          setSelected(library.active ?? "");
        }}
      >
        <Icon name="filter" />
      </AppButton>
      {library.active && (
        <AppButton
          type="button"
          className="filter-chip"
          aria-label="Unapply filter"
          onClick={() => onChange({ ...library, active: null })}
        >
          <span className="filter-trigger-label">
            {active ? filterIdentity(active).name : "Filter"}
          </span>
          <Icon name="close" />
        </AppButton>
      )}
      {open && (
        <Modal
          footer={
            <>
              {draft ? (
                <>
                  <AppButton variant="secondary" type="button" onClick={() => setDraft(undefined)}>
                    Cancel edit
                  </AppButton>
                  <AppButton
                    form={formId}
                    type="submit"
                    className="primary"
                    disabled={!!problem || !!error}
                  >
                    Save filter
                  </AppButton>
                </>
              ) : (
                <>
                  <AppButton variant={selected ? "secondary" : "primary"} onClick={close}>
                    Done
                  </AppButton>
                  {selected && (
                    <AppButton
                      variant="primary"
                      type="button"
                      disabled={!!filterProblem(entry, fields) || !!error}
                      onClick={() => onChange({ ...library, active: selected })}
                    >
                      Apply filter
                    </AppButton>
                  )}
                </>
              )}
            </>
          }
          initialFocus={
            draft ? 'input[aria-label="Filter name"]' : 'select[aria-label="Filter definition"]'
          }
          title="Filters"
          busy={false}
          onClose={close}
          className="filter-dialog"
          wide
        >
          <div className="filter-content">
            {error && (
              <div role="alert">
                <p>{error}</p>
                <AppButton
                  type="button"
                  onClick={() => {
                    onChange({ version: 1, definitions: [], active: null });
                    setDraft(undefined);
                  }}
                >
                  Reset saved filters
                </AppButton>
              </div>
            )}
            <div className="filter-library">
              <div>
                <CarbonSelect
                  labelText={<>Definition</>}
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
                </CarbonSelect>
              </div>
              <AppButton
                type="button"
                disabled={!!error}
                onClick={() => {
                  setDraft(fresh());
                  setSelected("");
                }}
              >
                New filter
              </AppButton>
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
                        <p role="status">
                          {retained
                            ? "Apply to search all retained history."
                            : `${preview(value, now)} matching rows`}
                        </p>
                      </>
                    )}
                    <div className="button-group">
                      <AppButton
                        type="button"
                        disabled={!editableFilter(item) || !!error}
                        onClick={() => setDraft(structuredClone(value))}
                      >
                        Edit filter
                      </AppButton>
                      <AppButton
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
                      </AppButton>
                    </div>
                  </section>
                );
              })()}
            {draft && (
              <form
                id={formId}
                onSubmit={(event) => {
                  event.preventDefault();
                  save();
                }}
              >
                <div>
                  <CarbonTextInput
                    labelText={<>Name</>}
                    aria-label="Filter name"
                    value={draft.name}
                    required
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                </div>
                <div>
                  <CarbonSelect
                    labelText={<>Conditions</>}
                    value={draft.mode}
                    onChange={(event) =>
                      setDraft({ ...draft, mode: event.target.value as "all" | "any" })
                    }
                  >
                    <option value="all">Match all</option>
                    <option value="any">Match any</option>
                  </CarbonSelect>
                </div>
                <div className="filter-rules">
                  {draft.conditions.map((rule, index) => {
                    const change = (value: typeof rule) =>
                      setDraft({
                        ...draft,
                        conditions: draft.conditions.map((item, i) => (i === index ? value : item)),
                      });
                    return (
                      <div className="filter-rule" key={rule.id}>
                        <div>
                          <CarbonSelect
                            labelText={<>Column</>}
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
                          </CarbonSelect>
                        </div>
                        <div>
                          <CarbonSelect
                            labelText={<>Comparison</>}
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
                          </CarbonSelect>
                        </div>
                        {rule.op !== "empty" && rule.op !== "present" && (
                          <div>
                            <CarbonTextInput
                              labelText="Value"
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
                          </div>
                        )}
                        <AppButton
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
                        </AppButton>
                      </div>
                    );
                  })}
                </div>
                <AppButton
                  type="button"
                  onClick={() =>
                    setDraft({ ...draft, conditions: [...draft.conditions, ...fresh().conditions] })
                  }
                >
                  Add condition
                </AppButton>
                <p role="status">
                  {problem ||
                    (retained
                      ? "Apply to search all retained history."
                      : `${preview(draft, now)} matching rows`)}
                </p>
              </form>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
