import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icons.js";
import { rowDensities, type TextStyles } from "./state.js";
import { TablePreview } from "./table-preview.js";
import {
  defaultView,
  type FilterKind,
  type TableId,
  type TableView,
  type ViewDefaults,
} from "./table-view.js";

export interface SettingsColumn {
  key: string;
  title: string;
  width: number;
  filter?: FilterKind;
  chart?: boolean;
}

/** Keep a data column visible when turning off the chart columns. */
function settingsColumnsFor(columns: readonly SettingsColumn[], view: TableView) {
  return columns.filter((column) => !column.chart || view.charts);
}

function visibleSettingsView(columns: readonly SettingsColumn[], view: TableView): TableView {
  const available = settingsColumnsFor(columns, view);
  if (!available.length || available.some((column) => !view.hidden.includes(column.key)))
    return view;
  return { ...view, hidden: view.hidden.filter((key) => key !== available[0]?.key) };
}

export function TableSettings({
  title,
  tableId,
  columns,
  defaults,
  view,
  onApply,
  onClose,
  charts,
  actions,
  textStyles,
}: {
  title: string;
  tableId: TableId;
  columns: SettingsColumn[];
  defaults: ViewDefaults;
  view: TableView;
  onApply(view: TableView | undefined): void;
  onClose(): void;
  charts: boolean;
  actions: boolean;
  textStyles: TextStyles;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const density = useRef<HTMLSelectElement>(null);
  const columnsMenu = useRef<HTMLDivElement>(null);
  const columnsTrigger = useRef<HTMLButtonElement>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  useEffect(() => {
    if (!columnsOpen) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !columnsMenu.current?.contains(event.target))
        setColumnsOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [columnsOpen]);
  // Undefined means Reset: Apply removes the saved override instead of freezing today's defaults.
  const [draft, setDraft] = useState<TableView | undefined>(() =>
    visibleSettingsView(columns, structuredClone(view)),
  );
  const current = draft ?? defaultView(defaults);
  const available = settingsColumnsFor(columns, current);
  const visibleCount = available.filter((column) => !current.hidden.includes(column.key)).length;
  useEffect(() => {
    dialog.current?.showModal();
    density.current?.focus();
  }, []);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  const change = (next: TableView) => setDraft(visibleSettingsView(columns, next));
  return (
    <dialog
      ref={dialog}
      className="setup-dialog table-settings-dialog"
      aria-labelledby={`${id}-title`}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (columnsOpen) {
            setColumnsOpen(false);
            columnsTrigger.current?.focus();
          } else close();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="modal-heading">
        <h2 id={`${id}-title`}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close table settings"
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="table-settings-body">
        <section className="table-settings-preview" aria-labelledby={`${id}-preview`}>
          <div className="table-preview-toolbar">
            <h3 id={`${id}-preview`}>Preview</h3>
            <div ref={columnsMenu} className="table-columns-dropdown">
              <button
                ref={columnsTrigger}
                type="button"
                aria-expanded={columnsOpen}
                aria-controls={`${id}-columns`}
                onClick={() => setColumnsOpen(!columnsOpen)}
              >
                Visible columns <Icon name="chevron--down" />
              </button>
              <fieldset
                id={`${id}-columns`}
                className="table-column-settings"
                hidden={!columnsOpen}
              >
                <legend>Visible columns</legend>
                <div className="table-column-choices">
                  {columns.map((column) => {
                    const enabled = !column.chart || current.charts;
                    const checked = !current.hidden.includes(column.key);
                    const last = enabled && checked && visibleCount <= 1;
                    return (
                      <label
                        key={column.key}
                        title={
                          !enabled
                            ? "Enable Inline charts to show this column"
                            : last
                              ? "Keep at least one column visible"
                              : undefined
                        }
                      >
                        <span>{column.title}</span>
                        <input
                          type="checkbox"
                          role="switch"
                          aria-checked={enabled && checked}
                          checked={enabled && checked}
                          disabled={!enabled || last}
                          onChange={(event) =>
                            change({
                              ...current,
                              hidden: event.target.checked
                                ? current.hidden.filter((key) => key !== column.key)
                                : [...current.hidden, column.key],
                            })
                          }
                        />
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          </div>
          <div className="table-preview-frame">
            <TablePreview
              tableId={tableId}
              columns={available}
              view={current}
              actions={actions}
              textStyles={textStyles}
            />
          </div>
        </section>
        <div className="table-settings-sections">
          <fieldset className="table-display-settings">
            <legend>Display</legend>
            <div className="table-display-choices">
              <label className="table-setting-row">
                <span id={`${id}-density`}>Row density</span>
                <select
                  ref={density}
                  aria-labelledby={`${id}-density`}
                  value={current.density}
                  onChange={(event) =>
                    change({ ...current, density: event.target.value as TableView["density"] })
                  }
                >
                  {rowDensities.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              {(["horizontal", "vertical", "heading"] as const).map((key) => (
                <label className="table-setting-row" key={key}>
                  <span>
                    {
                      {
                        horizontal: "Row lines",
                        vertical: "Column lines",
                        heading: "Heading lines",
                      }[key]
                    }
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={current.lines[key]}
                    checked={current.lines[key]}
                    onChange={(event) =>
                      change({
                        ...current,
                        lines: { ...current.lines, [key]: event.target.checked },
                      })
                    }
                  />
                </label>
              ))}
              <label className="table-setting-row">
                <span>Fit columns to width</span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={current.fit}
                  checked={current.fit}
                  onChange={(event) => change({ ...current, fit: event.target.checked })}
                />
              </label>
              {charts && (
                <label className="table-setting-row">
                  <span>Inline charts</span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={current.charts}
                    checked={current.charts}
                    onChange={(event) => change({ ...current, charts: event.target.checked })}
                  />
                </label>
              )}
            </div>
          </fieldset>
        </div>
      </div>
      <footer className="table-settings-footer">
        <button type="button" onClick={() => setDraft(undefined)}>
          Reset to defaults
        </button>
        <div className="table-settings-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              onApply(draft);
              close();
            }}
          >
            Apply
          </button>
        </div>
      </footer>
    </dialog>
  );
}
