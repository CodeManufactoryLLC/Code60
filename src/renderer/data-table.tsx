import {
  Pagination,
  Search,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TableSelectRow,
  TableToolbar,
  TableToolbarContent,
} from "@carbon/react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "./carbon/button.js";
import { Select } from "./carbon/fields.js";
import type { PageAction } from "./content-page-header.js";
import { FilterControls } from "./filter-controls.js";
import { Icon } from "./icons.js";
import { PageTitle } from "./page-title.js";
import {
  filterProblem,
  matchesSavedFilter,
  type SavedFilter,
  useSavedFilters,
} from "./saved-filters.js";
import { ColumnMenu } from "./table-controls.js";
import type { RowDensity, TableLines } from "./table-preferences.js";
import { type SettingsColumn, TableSettings } from "./table-settings.js";
import type { Rectangle } from "./table-types.js";
import {
  type ColumnFilter,
  type FilterKind,
  matchesColumn,
  orderedColumns,
  type TableId,
  useTableView,
} from "./table-view.js";
import { useTicker } from "./ticker.js";
import type { TextStyles } from "./typography.js";

const tableTitles: Record<TableId, string> = {
  "mcp-servers": "MCP Servers",
  automations: "Schedules",
  "automation-history": "Execution history",
  memories: "Memories",
  logs: "Logs",
  sessions: "Sessions",
  messages: "Messages",
  events: "Events",
  configurations: "Configurations",
  worktrees: "Worktrees",
  polling: "Polling",
};
export function TableHeading({
  tableId,
  actions,
}: {
  tableId: TableId;
  actions?: readonly PageAction[] | undefined;
}) {
  return tableId === "automations" || tableId === "automation-history" ? (
    <h2 className="table-card-title">{tableTitles[tableId]}</h2>
  ) : (
    <PageTitle page={tableId} className="table-title" actions={actions}>
      {tableTitles[tableId]}
    </PageTitle>
  );
}
export interface TableOptions {
  tableId: TableId;
  pageActions?: readonly PageAction[] | undefined;
  workspace?: string | undefined;
  lines: TableLines;
  density: RowDensity;
  fit: boolean;
  textStyles: TextStyles;
  selected: string | undefined;
  onSelect(id: string): void;
}
export interface RetainedTableQuery {
  search: string;
  conditions: { column: string; op: ColumnFilter["op"]; value: string }[];
  columnConditions: { column: string; op: ColumnFilter["op"]; value: string }[];
  match: "all" | "any";
}

/** Filter and order roots; pagination attaches children to their captured parent. */
export function orderedRows<Row extends { id: string }, Key extends keyof Row>(
  rows: Row[],
  sort: { key: Key; desc: boolean },
  matches: (row: Row) => boolean,
  parent?: ((row: Row) => string | undefined) | undefined,
): Row[] {
  const roots = rows.filter((row) => !parent?.(row) && matches(row));
  roots.sort((a, b) => {
    const x = a[sort.key] ?? "";
    const y = b[sort.key] ?? "";
    const order =
      typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return (sort.desc ? -order : order) || a.id.localeCompare(b.id);
  });
  return roots;
}

function TableContent<Row extends { id: string }, Key extends keyof Row & string>({
  rows,
  selected,
  onSelect,
  onActions,
  lines: defaultLines,
  density: defaultDensity,
  fit: defaultFit,
  textStyles,
  columns: allColumns,
  settingsColumns,
  defaultCharts = true,
  display,
  initialSort,
  initialDescending = false,
  tint,
  align,
  renderCell,
  parent,
  hasActions,
  tableId,
  workspace,
  onAdd,
  addLabel,
  addDisabled,
  viewState,
  pageActions,
  scope,
  onRetainedQuery,
}: {
  rows: Row[];
  columns: { key: Key; title: string; width: number; filter?: FilterKind }[];
  settingsColumns?: SettingsColumn[];
  defaultCharts?: boolean;
  onAdd?(): void;
  addLabel?: string;
  addDisabled?: boolean;
  viewState?: ReturnType<typeof useTableView>;
  display(row: Row, key: Key): string;
  initialSort: Key;
  initialDescending?: boolean;
  tint?(row: Row, key: Key): string | undefined;
  align?(key: Key): "left" | "right";
  renderCell?(row: Row, key: Key): ReactNode;
  onActions?(id: string, bounds: Rectangle, contextual?: boolean): void;
  parent?(row: Row): string | undefined;
  hasActions?(row: Row): boolean;
  scope?: ReactNode;
  onRetainedQuery?(query: RetainedTableQuery): void;
} & TableOptions) {
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const ownView = useTableView(
    tableId,
    { lines: defaultLines, density: defaultDensity, fit: defaultFit },
    !viewState,
  );
  const [view, setView, storageError] = viewState ?? ownView;
  const columns = useMemo(() => orderedColumns(allColumns, view), [allColumns, view]);
  const [filters, setFilters] = useState<Partial<Record<Key, ColumnFilter>>>({});
  const named = useSavedFilters(tableId, workspace ?? "none");
  const fields = allColumns.map((column) => ({
    key: column.key,
    title: column.title,
    kind:
      column.filter ??
      (typeof rows.find((row) => row[column.key] != null)?.[column.key] === "number"
        ? ("number" as const)
        : ("text" as const)),
  }));
  const definition = named.library.definitions.find(
    (item) => item && typeof item === "object" && "id" in item && item.id === named.library.active,
  );
  const incompatibility = named.library.active ? filterProblem(definition, fields) : "";
  const activeFilter = definition && !incompatibility ? (definition as SavedFilter) : undefined;
  const now = useTicker(
    !!activeFilter?.conditions.some((rule) => rule.op === "recent" || rule.op === "older") ||
      Object.values(filters).some((rule) =>
        ["recent", "older"].includes((rule as ColumnFilter)?.op),
      ),
    30000,
  );
  const matchesColumns = useCallback(
    (row: Row) =>
      allColumns.every((column) => {
        const filter = filters[column.key];
        return (
          !filter ||
          matchesColumn(
            row[column.key],
            display(row, column.key),
            column.filter ?? (typeof row[column.key] === "number" ? "number" : "text"),
            filter,
            now,
          )
        );
      }),
    [allColumns, display, filters, now],
  );
  const matchesNamed = useCallback(
    (row: Row, filter: SavedFilter, at = now) =>
      matchesSavedFilter(
        filter,
        (key) => ({ raw: row[key as Key], text: display(row, key as Key) }),
        at,
      ),
    [display, now],
  );
  const [query, setQuery] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const retainedHandler = useRef(onRetainedQuery);
  retainedHandler.current = onRetainedQuery;
  const retainedQuery = JSON.stringify({
    search: submittedSearch,
    match: activeFilter?.mode ?? "all",
    conditions:
      activeFilter?.conditions.map(({ column, op, value }) => ({ column, op, value })) ?? [],
    columnConditions: Object.entries(filters).map(([column, rule]) => ({
      column,
      ...(rule as ColumnFilter),
    })),
  });
  useEffect(() => {
    retainedHandler.current?.(JSON.parse(retainedQuery) as RetainedTableQuery);
  }, [retainedQuery]);
  const [settings, setSettings] = useState<string>();
  const settingsScope = JSON.stringify([tableId, workspace]);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const [headerMenu, setHeaderMenu] = useState<{ key: Key; bounds: Rectangle }>();
  const [sort, setSort] = useState({ key: initialSort, desc: initialDescending });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  // biome-ignore lint/correctness/useExhaustiveDependencies: workspace changes clear only this view's local query/dialog ownership.
  useEffect(() => {
    setSettings(undefined);
    setFilters({});
    setHeaderMenu(undefined);
    setQuery("");
    setSubmittedSearch("");
    setPage(1);
  }, [workspace, tableId]);
  useEffect(() => {
    const find = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "f" ||
        !container.current?.closest(".page-panel")?.checkVisibility() ||
        document.querySelector("dialog[open]")
      )
        return;
      event.preventDefault();
      search.current?.focus();
    };
    window.addEventListener("keydown", find);
    return () => window.removeEventListener("keydown", find);
  }, []);
  const roots = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const textMatch = (row: Row) =>
      !needle ||
      allColumns.some(({ key }) => display(row, key).toLocaleLowerCase().includes(needle));
    return orderedRows(
      rows,
      sort,
      (row) =>
        !!onRetainedQuery ||
        (matchesColumns(row) &&
          (!activeFilter || matchesNamed(row, activeFilter)) &&
          (textMatch(row) ||
            (!!parent && rows.some((child) => parent(child) === row.id && textMatch(child))))),
      parent,
    );
  }, [
    rows,
    sort,
    query,
    allColumns,
    display,
    onRetainedQuery,
    matchesColumns,
    activeFilter,
    matchesNamed,
    parent,
  ]);
  const currentPage = onRetainedQuery
    ? 1
    : Math.min(page, Math.max(1, Math.ceil(roots.length / pageSize)));
  const visible = useMemo(() => {
    // Retained logs already have bounded backend cursor pages. A second pager would
    // incorrectly keep live following enabled while displaying an older local page.
    const top = onRetainedQuery
      ? roots
      : roots.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    if (!parent) return top;
    const children = new Map<string, Row[]>();
    for (const row of rows) {
      const key = parent(row);
      if (key) children.set(key, [...(children.get(key) ?? []), row]);
    }
    return top.flatMap((row) => [row, ...(children.get(row.id) ?? [])]);
  }, [roots, currentPage, pageSize, rows, parent, onRetainedQuery]);
  const actionable = (row: Row) => !!onActions && (hasActions?.(row) ?? true);
  const closeSettings = () => {
    setSettings(undefined);
    if (settingsTrigger.current?.checkVisibility()) settingsTrigger.current.focus();
  };
  return (
    <TableContainer className="data-table carbon-data-table">
      <div className="table-controls">
        <TableHeading tableId={tableId} actions={pageActions} />
        {scope && <div className="table-scope">{scope}</div>}
      </div>
      <TableToolbar aria-label={`${tableTitles[tableId]} controls`}>
        <TableToolbarContent>
          <form
            className="carbon-table-search"
            onSubmit={(event) => {
              event.preventDefault();
              if (onRetainedQuery) setSubmittedSearch(query);
            }}
          >
            <Search
              id={`${id}-search`}
              ref={search}
              labelText={
                onRetainedQuery ? "Search retained logs" : `Search ${tableTitles[tableId]}`
              }
              placeholder={
                onRetainedQuery ? "Search retained logs" : `Search ${tableTitles[tableId]}`
              }
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
                if (!event.target.value) setSubmittedSearch("");
              }}
            />
            {onRetainedQuery && <Button type="submit">Search history</Button>}
          </form>
          <FilterControls
            key={`${tableId}:${workspace}`}
            fields={fields}
            library={named.library}
            error={named.error}
            onChange={(value) => {
              named.update(value);
              setPage(1);
            }}
            preview={(filter, at) =>
              rows.filter(
                (row) => !parent?.(row) && matchesColumns(row) && matchesNamed(row, filter, at),
              ).length
            }
            retained={!!onRetainedQuery}
          />
          <Select
            aria-label="Column menu"
            value=""
            onChange={(event) => {
              if (event.target.value)
                setHeaderMenu({
                  key: event.target.value as Key,
                  bounds: event.currentTarget.getBoundingClientRect(),
                });
            }}
          >
            <option value="">Column filter and sort</option>
            {allColumns.map((column) => (
              <option key={column.key} value={column.key}>
                {column.title}
              </option>
            ))}
          </Select>
          <Button
            className="icon-button"
            ref={settingsTrigger}
            aria-haspopup="dialog"
            aria-label="Settings"
            title="Table settings"
            onClick={() => setSettings(settingsScope)}
          >
            <Icon name="settings--adjust" />
          </Button>
          {onAdd && (
            <Button variant="primary" disabled={addDisabled} onClick={onAdd}>
              {addLabel}
            </Button>
          )}
        </TableToolbarContent>
      </TableToolbar>
      {incompatibility && (
        <p role="alert">Saved filter is incompatible and has not been applied: {incompatibility}</p>
      )}
      {storageError && <p role="status">{storageError}</p>}
      {Object.keys(filters).length > 0 && (
        <section className="table-filter-bar" aria-label="Applied column filters">
          {allColumns
            .filter((column) => filters[column.key])
            .map((column) => (
              <Button
                key={column.key}
                variant="quiet"
                aria-label={`Clear ${column.title} filter`}
                onClick={() => {
                  setFilters((value) => {
                    const next = { ...value };
                    delete next[column.key];
                    return next;
                  });
                  setPage(1);
                }}
              >
                {column.title}
                <Icon name="close" />
              </Button>
            ))}
          <Button
            variant="quiet"
            onClick={() => {
              setFilters({});
              setPage(1);
            }}
          >
            Clear all filters
          </Button>
        </section>
      )}
      <div
        ref={container}
        className="carbon-table-scroll"
        style={
          {
            "--table-width": `${columns.reduce((sum, column) => sum + (view.widths[column.key] ?? column.width), onActions ? 144 : 48)}px`,
          } as CSSProperties
        }
        data-fit-columns={view.fit}
        data-horizontal={view.lines.horizontal}
        data-vertical={view.lines.vertical}
        data-heading-lines={view.lines.heading}
      >
        <Table
          aria-label={tableTitles[tableId]}
          size={view.density === "high" ? "sm" : view.density === "medium" ? "md" : "lg"}
        >
          <colgroup>
            <col style={{ width: 48 }} />
            {columns.map((column) => (
              <col
                key={column.key}
                style={{ width: view.fit ? undefined : (view.widths[column.key] ?? column.width) }}
              />
            ))}
            {onActions && <col style={{ width: 96 }} />}
          </colgroup>
          <TableHead>
            <TableRow>
              <TableHeader>
                <span className="cds--visually-hidden">Select row</span>
              </TableHeader>
              {columns.map(({ key, title }) => (
                <TableHeader
                  key={key}
                  scope="col"
                  isSortable
                  isSortHeader={sort.key === key}
                  sortDirection={sort.key === key ? (sort.desc ? "DESC" : "ASC") : "NONE"}
                  onClick={() => {
                    setSort({ key, desc: sort.key === key ? !sort.desc : false });
                    setPage(1);
                  }}
                >
                  {title}
                </TableHeader>
              ))}
              {onActions && <TableHeader scope="col">Actions</TableHeader>}
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((row) => (
              <TableRow
                key={row.id}
                isSelected={selected === row.id}
                data-row-id={row.id}
                data-parent={parent?.(row)}
                onClick={(event) => {
                  if (
                    event.target instanceof Element &&
                    event.target.closest("button, input, label, a, select")
                  )
                    return;
                  onSelect(row.id);
                }}
                onContextMenu={(event) => {
                  if (!actionable(row)) return;
                  event.preventDefault();
                  onActions?.(
                    row.id,
                    { x: event.clientX, y: event.clientY, width: 0, height: 0 },
                    true,
                  );
                }}
                onKeyDown={(event) => {
                  if (
                    actionable(row) &&
                    (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    onActions?.(row.id, event.currentTarget.getBoundingClientRect(), true);
                  }
                }}
              >
                <TableSelectRow
                  id={`${id}-${row.id}`}
                  name={`${id}-selection`}
                  radio
                  aria-label={`Select ${display(row, columns[0]?.key ?? initialSort)}`}
                  checked={selected === row.id}
                  onSelect={() => onSelect(row.id)}
                />
                {columns.map(({ key }) => (
                  <TableCell
                    key={key}
                    style={{
                      textAlign: align?.(key),
                      color: tint?.(row, key) ? `var(${tint(row, key)})` : undefined,
                    }}
                  >
                    {renderCell?.(row, key) ?? display(row, key)}
                  </TableCell>
                ))}
                {onActions && (
                  <TableCell>
                    {actionable(row) && (
                      <Button
                        variant="quiet"
                        className="small"
                        aria-label={`Actions for ${display(row, columns[0]?.key ?? initialSort)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onActions(row.id, event.currentTarget.getBoundingClientRect());
                        }}
                      >
                        Actions
                        <Icon name="chevron--down" />
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {!visible.length && (
              <TableRow>
                <TableCell colSpan={columns.length + 1 + Number(!!onActions)}>
                  {query || Object.keys(filters).length || activeFilter
                    ? "No rows match these filters."
                    : "No rows yet."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {!onRetainedQuery && (
        <Pagination
          page={currentPage}
          pageSize={pageSize}
          pageSizes={[25, 50, 100]}
          totalItems={roots.length}
          itemsPerPageText={parent ? "Groups per page" : "Rows per page"}
          onChange={({ page, pageSize }) => {
            setPage(page);
            setPageSize(pageSize);
          }}
        />
      )}
      {settings === settingsScope &&
        createPortal(
          <TableSettings
            title={`${tableTitles[tableId]} table settings`}
            tableId={tableId}
            columns={settingsColumns ?? allColumns}
            defaults={{
              lines: defaultLines,
              density: defaultDensity,
              fit: defaultFit,
              charts: defaultCharts,
            }}
            view={view}
            onApply={setView}
            onClose={closeSettings}
            charts={tableId === "sessions"}
            actions={!!onActions}
            textStyles={textStyles}
          />,
          document.body,
        )}
      {headerMenu &&
        createPortal(
          <ColumnMenu
            key={headerMenu.key}
            title={
              allColumns.find((column) => column.key === headerMenu.key)?.title ?? headerMenu.key
            }
            kind={
              allColumns.find((column) => column.key === headerMenu.key)?.filter ??
              (typeof rows.find((row) => row[headerMenu.key] != null)?.[headerMenu.key] === "number"
                ? "number"
                : "text")
            }
            values={[
              ...new Set(
                rows.filter((row) => !parent?.(row)).map((row) => display(row, headerMenu.key)),
              ),
            ].sort()}
            filter={filters[headerMenu.key]}
            bounds={headerMenu.bounds}
            onClose={() => {
              setHeaderMenu(undefined);
              search.current?.focus();
            }}
            onSort={(desc) => {
              setSort({ key: headerMenu.key, desc });
              setPage(1);
              setHeaderMenu(undefined);
            }}
            onFilter={(filter) => {
              setFilters((value) => {
                const next = { ...value };
                if (filter) next[headerMenu.key] = filter;
                else delete next[headerMenu.key];
                return next;
              });
              setPage(1);
              setHeaderMenu(undefined);
            }}
          />,
          document.body,
        )}
    </TableContainer>
  );
}

/** Local searches, menus and pagination belong to their rendered workspace. */
export function DataTable<Row extends { id: string }, Key extends keyof Row & string>(
  props: Parameters<typeof TableContent<Row, Key>>[0],
) {
  return <TableContent key={JSON.stringify([props.tableId, props.workspace])} {...props} />;
}
