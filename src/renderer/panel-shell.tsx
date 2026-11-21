import {
  type CSSProperties,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons.js";
import { Card } from "./neobrutalism/card.js";
import { Combobox } from "./neobrutalism/combobox.js";

export interface PanelTab {
  id: number;
  label: string;
  title: string;
  icon: IconName;
  closeButton?: boolean;
}
export interface PanelPage {
  id: string;
  label: string;
  icon: IconName;
  select(): void;
}
export type PanelAction =
  | { type: "add" }
  | { type: "select" | "close"; id: number }
  | { type: "move"; id: number; to: number };

/** Layout and tab interactions only; callers own tab identity, content, and external reads. */
export function PanelShell({
  tabs,
  pages = [],
  selectedId,
  onAction,
  open,
  active,
  onToggle,
  name,
  id,
  emptyLabel,
  children,
  disabled = false,
}: {
  tabs: readonly PanelTab[];
  pages?: readonly PanelPage[];
  selectedId: number | null;
  onAction(action: PanelAction): number | null;
  open: boolean;
  active: boolean;
  onToggle(): void;
  name: string;
  id: string;
  emptyLabel: string;
  children(focusActiveTab: () => void): ReactNode;
  disabled?: boolean;
}) {
  const prefix = useId();
  const panel = useRef<HTMLElement>(null);
  const toggleButton = useRef<HTMLButtonElement>(null);
  const [toggleTarget, setToggleTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setToggleTarget(active ? document.getElementById("workspace-panel-actions") : null);
  }, [active]);
  const [resizing, setResizing] = useState(false);
  const [width, setWidth] = useState<number>();
  const [announcement, setAnnouncement] = useState("");
  const selector = useRef<HTMLButtonElement>(null);
  const focus = useRef(false);
  const selected = tabs.find((tab) => tab.id === selectedId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Tab/selection updates settle pending keyboard focus after an action.
  useLayoutEffect(() => {
    if (!active || !open) return;
    if (focus.current) selector.current?.focus();
    focus.current = false;
  }, [tabs, selectedId, active, open]);

  const act = (action: PanelAction) => {
    if (disabled) return;
    onAction(action);
    focus.current = true;
  };
  const resize = (value: number) => {
    let container = panel.current?.parentElement;
    // Retained owners use display:contents wrappers, which have no layout box.
    while (container && container.getClientRects().length === 0)
      container = container.parentElement;
    const available = container?.getBoundingClientRect().width ?? 600;
    const gap = panel.current
      ? Number.parseFloat(getComputedStyle(panel.current).marginInlineStart) || 0
      : 0;
    setWidth(Math.max(120, Math.min(available - 300 - gap, value)));
  };
  const toggle = (
    <button
      ref={toggleButton}
      type="button"
      className={`icon-button file-panel-toggle${open ? "" : " file-panel-open"}`}
      aria-label={`Toggle ${name.toLowerCase()} panel`}
      title={`${open ? "Close" : "Open"} ${name.toLowerCase()} panel`}
      aria-expanded={open}
      aria-controls={id}
      disabled={disabled}
      onClick={() => {
        onToggle();
      }}
    >
      <Icon name={open ? "side-panel--close" : "side-panel--open"} />
    </button>
  );
  return (
    <>
      <Card
        as="aside"
        ref={panel}
        id={id}
        className="file-panel"
        aria-label={`${name} panel`}
        aria-hidden={!open}
        inert={!open}
        data-minimized={!open}
        data-resizing={resizing}
        style={
          width === undefined
            ? undefined
            : ({ "--file-panel-width": `${width}px` } as CSSProperties)
        }
      >
        <button
          type="button"
          className="file-column-resize"
          disabled={disabled}
          aria-label={`Resize ${name.toLowerCase()} panel`}
          title={`Resize ${name.toLowerCase()} panel (Left/Right arrows)`}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              resize(
                (panel.current?.getBoundingClientRect().width ?? 120) +
                  (event.key === "ArrowLeft" ? 20 : -20),
              );
            }
          }}
          onPointerDown={(event) => {
            setResizing(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onLostPointerCapture={() => setResizing(false)}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId) && panel.current)
              resize(panel.current.getBoundingClientRect().right - event.clientX);
          }}
          onPointerUp={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            if (panel.current) resize(panel.current.getBoundingClientRect().right - event.clientX);
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
        />
        <div className="file-panel-toolbar">
          <div className="file-tab-actions" inert={!open} aria-hidden={!open}>
            <div className="file-tab-selector">
              <Combobox
                label={`${name} view`}
                listLabel={`Open ${name} tabs`}
                placeholder="No open tabs"
                value={selectedId === null ? "" : String(selectedId)}
                options={[
                  ...tabs.map((tab) => ({
                    id: String(tab.id),
                    label: tab.label,
                    title: `${tab.title} (Delete to close; Alt+Left/Right to reorder)`,
                    icon: <Icon name={tab.icon} />,
                  })),
                  ...pages.map((page) => ({
                    id: page.id,
                    label: page.label,
                    title: `Open ${page.label}`,
                    icon: <Icon name={page.icon} />,
                  })),
                  { id: "new-tab", label: "+ New Tab" },
                ]}
                triggerRef={selector}
                disabled={disabled || !active || !open}
                onSelect={(id) => {
                  if (id === "new-tab") {
                    act({ type: "add" });
                    return;
                  }
                  const tab = tabs.find((entry) => String(entry.id) === id);
                  if (tab) onAction({ type: "select", id: tab.id });
                  else pages.find((page) => page.id === id)?.select();
                }}
                onTriggerKeyDown={(event) => {
                  if (event.currentTarget.getAttribute("aria-expanded") === "true" || !selected)
                    return;
                  if (event.key === "Delete") {
                    event.preventDefault();
                    act({ type: "close", id: selected.id });
                  } else if (
                    event.altKey &&
                    (event.key === "ArrowLeft" || event.key === "ArrowRight")
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    const index = tabs.findIndex((tab) => tab.id === selected.id);
                    const to = index + (event.key === "ArrowLeft" ? -1 : 1);
                    if (to >= 0 && to < tabs.length) {
                      act({ type: "move", id: selected.id, to });
                      setAnnouncement(`Tab moved to position ${to + 1} of ${tabs.length}.`);
                    }
                  }
                }}
              />
            </div>
          </div>
        </div>
        <section
          className="file-panel-content"
          inert={!open}
          aria-hidden={!open}
          id={`${prefix}-content`}
          aria-label={selected ? `${name}: ${selected.title}` : emptyLabel}
        >
          {selected && selected.closeButton !== false && (
            <div className="file-panel-view-actions">
              <button
                type="button"
                className="icon-button file-tab-close"
                aria-label="Close current tab"
                title={`Close ${selected.title}`}
                disabled={disabled}
                onClick={() => act({ type: "close", id: selected.id })}
              >
                <Icon name="close" />
              </button>
            </div>
          )}
          {children(() => {
            focus.current = true;
          })}
        </section>
        <span className="sr-only" role="status">
          {announcement}
        </span>
      </Card>
      {active && (toggleTarget ? createPortal(toggle, toggleTarget) : toggle)}
    </>
  );
}
