import type { Rectangle } from "@glideapps/glide-data-grid";
import { useEffect, useId, useRef, useState } from "react";
import { operators as filterOperators } from "./saved-filters.js";
import { type ColumnFilter, type FilterKind, filterLabels } from "./table-view.js";

export function ColumnMenu({
  title,
  kind,
  values,
  filter,
  bounds,
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
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [op, setOp] = useState<ColumnFilter["op"]>(
    filter?.op ?? (kind === "text" ? "contains" : "eq"),
  );
  const [value, setValue] = useState(
    filter?.value ?? (kind === "category" ? (values[0] ?? "") : ""),
  );
  const [position, setPosition] = useState({ left: bounds.x, top: bounds.y + bounds.height });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const box = element.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(bounds.x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(bounds.y + bounds.height, window.innerHeight - box.height - 8)),
    });
    element.querySelector<HTMLElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) close.current();
    };
    const dismiss = () => close.current();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [bounds]);
  const operators = filterOperators(kind);
  const needsValue = op !== "empty" && op !== "present";
  return (
    <div
      className="column-menu"
      role="dialog"
      aria-labelledby={id}
      ref={ref}
      style={position}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <strong id={id}>{title}</strong>
      <div className="button-group">
        <button type="button" onClick={() => onSort(false)}>
          Sort ascending
        </button>
        <button type="button" onClick={() => onSort(true)}>
          Sort descending
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onFilter({ op, value });
        }}
      >
        <label>
          Condition
          <select value={op} onChange={(event) => setOp(event.target.value as ColumnFilter["op"])}>
            {operators.map((candidate) => (
              <option key={candidate} value={candidate}>
                {filterLabels[candidate]}
              </option>
            ))}
          </select>
        </label>
        {needsValue && (
          <label htmlFor={`${id}-value`}>
            Value
            {kind === "category" ? (
              <select
                id={`${id}-value`}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              >
                {values.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {candidate || "(empty)"}
                  </option>
                ))}
              </select>
            ) : (
              <input
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
        <div className="button-group">
          <button type="submit" className="primary" disabled={needsValue && !value.trim()}>
            Apply filter
          </button>
          <button type="button" onClick={() => onFilter(undefined)}>
            Clear filter
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </form>
    </div>
  );
}
