import { useEffect, useId, useRef, useState } from "react";
import { Button as AppButton } from "./carbon/button.js";
import { Checkbox as CarbonCheckbox } from "./carbon/choices.js";
import { Select as CarbonSelect } from "./carbon/fields.js";
import { Icon } from "./icons.js";
import { Modal } from "./modal.js";
import { rowDensities } from "./table-preferences.js";
import { TablePreview } from "./table-preview.js";
import {
  defaultView,
  type FilterKind,
  orderedColumns,
  type TableId,
  type TableView,
  type ViewDefaults,
} from "./table-view.js";
import type { TextStyles } from "./typography.js";

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
  const arranged = orderedColumns(available, { ...current, hidden: [] });
  const moveColumn = (key: string, offset: number) => {
    const order = arranged.map((column) => column.key);
    const index = order.indexOf(key);
    const to = index + offset;
    const target = order[to];
    if (index < 0 || !target) return;
    order[to] = key;
    order[index] = target;
    change({ ...current, order });
  };
  const visibleCount = available.filter((column) => !current.hidden.includes(column.key)).length;
  useEffect(() => {
    density.current?.focus();
  }, []);
  const close = () => {
    onClose();
  };
  const change = (next: TableView) => setDraft(visibleSettingsView(columns, next));
  return (
    <Modal
      title={title}
      busy={false}
      onClose={close}
      closeLabel="Close table settings"
      className="table-settings-dialog"
      wide
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
    >
      <div className="table-settings-body">
        <section className="table-settings-preview" aria-labelledby={`${id}-preview`}>
          <div className="table-preview-toolbar">
            <h3 id={`${id}-preview`}>Preview</h3>
            <div ref={columnsMenu} className="table-columns-dropdown">
              <AppButton
                ref={columnsTrigger}
                type="button"
                aria-expanded={columnsOpen}
                aria-controls={`${id}-columns`}
                onClick={() => setColumnsOpen(!columnsOpen)}
              >
                Visible columns <Icon name="chevron--down" />
              </AppButton>
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
                      <div
                        key={column.key}
                        title={
                          !enabled
                            ? "Enable Inline charts to show this column"
                            : last
                              ? "Keep at least one column visible"
                              : undefined
                        }
                      >
                        <CarbonCheckbox
                          labelText={
                            <>
                              <span>{column.title}</span>
                            </>
                          }
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
                      </div>
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
              <div className="table-setting-row">
                <CarbonSelect
                  labelText={
                    <>
                      <span id={`${id}-density`}>Row density</span>
                    </>
                  }
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
                </CarbonSelect>
              </div>
              {(["horizontal", "vertical", "heading"] as const).map((key) => (
                <div className="table-setting-row" key={key}>
                  <CarbonCheckbox
                    labelText={
                      <>
                        <span>
                          {
                            {
                              horizontal: "Row lines",
                              vertical: "Column lines",
                              heading: "Heading lines",
                            }[key]
                          }
                        </span>
                      </>
                    }
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
                </div>
              ))}
              <div className="table-setting-row">
                <CarbonCheckbox
                  labelText={
                    <>
                      <span>Fit columns to width</span>
                    </>
                  }
                  role="switch"
                  aria-checked={current.fit}
                  checked={current.fit}
                  onChange={(event) => change({ ...current, fit: event.target.checked })}
                />
              </div>
              {charts && (
                <div className="table-setting-row">
                  <CarbonCheckbox
                    labelText={
                      <>
                        <span>Inline charts</span>
                      </>
                    }
                    role="switch"
                    aria-checked={current.charts}
                    checked={current.charts}
                    onChange={(event) => change({ ...current, charts: event.target.checked })}
                  />
                </div>
              )}
            </div>
          </fieldset>
          <fieldset className="table-column-layout">
            <legend>Column order and width</legend>
            {arranged.map((column, index) => {
              const width = current.widths[column.key] ?? column.width;
              return (
                <div key={column.key} className="table-column-layout-row">
                  <span>{column.title}</span>
                  <CarbonSelect
                    labelText={`Width for ${column.title}`}
                    value={width}
                    disabled={current.fit}
                    onChange={(event) =>
                      change({
                        ...current,
                        widths: { ...current.widths, [column.key]: Number(event.target.value) },
                      })
                    }
                  >
                    {[...new Set([80, 120, 160, 240, 320, 480, width])]
                      .sort((a, b) => a - b)
                      .map((value) => (
                        <option key={value} value={value}>
                          {value}px
                        </option>
                      ))}
                  </CarbonSelect>
                  <AppButton
                    type="button"
                    className="small"
                    aria-label={`Move ${column.title} earlier`}
                    disabled={index === 0}
                    onClick={() => moveColumn(column.key, -1)}
                  >
                    Earlier
                  </AppButton>
                  <AppButton
                    type="button"
                    className="small"
                    aria-label={`Move ${column.title} later`}
                    disabled={index === arranged.length - 1}
                    onClick={() => moveColumn(column.key, 1)}
                  >
                    Later
                  </AppButton>
                </div>
              );
            })}
          </fieldset>
        </div>
      </div>
      <footer className="table-settings-footer">
        <AppButton type="button" onClick={() => setDraft(undefined)}>
          Reset to defaults
        </AppButton>
        <div className="table-settings-actions">
          <AppButton type="button" onClick={close}>
            Cancel
          </AppButton>
          <AppButton
            type="button"
            className="primary"
            onClick={() => {
              onApply(draft);
              close();
            }}
          >
            Apply
          </AppButton>
        </div>
      </footer>
    </Modal>
  );
}
