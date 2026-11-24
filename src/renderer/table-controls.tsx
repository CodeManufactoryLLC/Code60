import { type ReactNode, useId, useState } from "react";
import { Button as AppButton } from "./carbon/button.js";
import { Select as CarbonSelect, TextInput as CarbonTextInput } from "./carbon/fields.js";
import { Icon } from "./icons.js";
import { Modal } from "./modal.js";
import { operators as filterOperators } from "./saved-filters.js";
import type { Rectangle } from "./table-types.js";
import { type ColumnFilter, type FilterKind, filterLabels } from "./table-view.js";

interface PagerStep {
  label: string;
  disabled: boolean;
  onClick(): void;
}

/** Compact previous/next paging for server-backed tables. */
export function TablePager({
  label,
  page,
  summary,
  previous,
  next,
}: {
  label: string;
  page: number;
  summary?: ReactNode;
  previous: PagerStep;
  next: PagerStep;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: these controls are page actions.
    <div className="table-pager" role="group" aria-label={label}>
      <span className="table-pager-summary">{summary}</span>
      <AppButton
        type="button"
        className="icon-button"
        aria-label={previous.label}
        disabled={previous.disabled}
        onClick={previous.onClick}
      >
        <Icon name="chevron--left" />
      </AppButton>
      <span className="table-pager-page">Page {page}</span>
      <AppButton
        type="button"
        className="icon-button"
        aria-label={next.label}
        disabled={next.disabled}
        onClick={next.onClick}
      >
        <Icon name="chevron--right" />
      </AppButton>
    </div>
  );
}

export function ColumnMenu({
  title,
  kind,
  values,
  filter,
  bounds: _bounds,
  onClose,
  onSort,
  onFilter,
}: {
  title: string;
  kind: FilterKind;
  values: string[];
  filter: ColumnFilter | undefined;
  bounds: Rectangle;
  onClose(): void;
  onSort(desc: boolean): void;
  onFilter(filter: ColumnFilter | undefined): void;
}) {
  const id = useId();
  const [op, setOp] = useState<ColumnFilter["op"]>(
    filter?.op ?? (kind === "text" ? "contains" : "eq"),
  );
  const [value, setValue] = useState(
    filter?.value ?? (kind === "category" ? (values[0] ?? "") : ""),
  );
  const operators = filterOperators(kind);
  const needsValue = op !== "empty" && op !== "present";
  return (
    <Modal
      footer={
        <>
          <AppButton variant="secondary" type="button" onClick={onClose}>
            Close
          </AppButton>
          <AppButton
            form={id}
            type="submit"
            className="primary"
            disabled={needsValue && !value.trim()}
          >
            Apply filter
          </AppButton>
        </>
      }
      title={`${title} filter and sort`}
      busy={false}
      onClose={onClose}
      className="column-filter-dialog"
    >
      <div className="button-group">
        <AppButton type="button" onClick={() => onSort(false)}>
          Sort ascending
        </AppButton>
        <AppButton type="button" onClick={() => onSort(true)}>
          Sort descending
        </AppButton>
      </div>
      <form
        id={id}
        onSubmit={(event) => {
          event.preventDefault();
          onFilter({ op, value });
        }}
      >
        <div>
          <CarbonSelect
            labelText={<>Condition</>}
            value={op}
            onChange={(event) => setOp(event.target.value as ColumnFilter["op"])}
          >
            {operators.map((candidate) => (
              <option key={candidate} value={candidate}>
                {filterLabels[candidate]}
              </option>
            ))}
          </CarbonSelect>
        </div>
        {needsValue && (
          <label htmlFor={`${id}-value`}>
            Value
            {kind === "category" ? (
              <CarbonSelect
                id={`${id}-value`}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              >
                {values.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {candidate || "(empty)"}
                  </option>
                ))}
              </CarbonSelect>
            ) : (
              <CarbonTextInput
                id={`${id}-value`}
                required
                type={
                  kind === "number" || op === "recent" || op === "older"
                    ? "number"
                    : kind === "date"
                      ? "datetime-local"
                      : "text"
                }
                step={kind === "number" ? "any" : undefined}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </label>
        )}
        <AppButton type="button" onClick={() => onFilter(undefined)}>
          Clear filter
        </AppButton>
      </form>
    </Modal>
  );
}
