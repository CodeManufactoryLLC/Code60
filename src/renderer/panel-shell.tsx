import {
  type CSSProperties,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Icon, type IconName } from "./icons.js";

export interface PanelTab {
  id: number;
  label: string;
  title: string;
  icon: IconName;
}
export type PanelAction =
  | { type: "add" }
  | { type: "select" | "close"; id: number }
  | { type: "move"; id: number; to: number };

/** Layout and tab interactions only; callers own tab identity, content, and external reads. */
export function PanelShell({
  tabs,
  selectedId,
  onAction,
  open,
  active,
  onToggle,
  name,
  id,
  emptyLabel,
  children,
}: {
  tabs: readonly PanelTab[];
  selectedId: number | null;
  onAction(action: PanelAction): number | null;
  open: boolean;
  active: boolean;
  onToggle(): void;
  name: string;
  id: string;
  emptyLabel: string;
  children(focusActiveTab: () => void): ReactNode;
}) {
  const prefix = useId();
  const panel = useRef<HTMLElement>(null);
  const toggleButton = useRef<HTMLButtonElement>(null);
  const restoreToggle = useRef(false);
  const [resizing, setResizing] = useState(false);
  const [width, setWidth] = useState<number>();
  const [announcement, setAnnouncement] = useState("");
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const add = useRef<HTMLButtonElement>(null);
  const focus = useRef<number | "add" | "active" | null>(null);
  const drag = useRef<number | null>(null);
  const selected = tabs.find((tab) => tab.id === selectedId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reordering tabs must restore focus even when the selected ID is unchanged.
  useLayoutEffect(() => {
    if (!active || !open) return;
    if (focus.current === "add") add.current?.focus();
    else if (focus.current !== null)
      buttons.current.get(focus.current === "active" ? (selectedId ?? -1) : focus.current)?.focus();
    focus.current = null;
    buttons.current.get(selectedId ?? -1)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tabs, selectedId, active, open]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Opening/closing moves the toggle between containers, so restore focus to its replacement.
  useLayoutEffect(() => {
    if (active && restoreToggle.current) {
      toggleButton.current?.focus();
      restoreToggle.current = false;
    }
  }, [open, active]);

  const act = (action: PanelAction) => {
    focus.current = onAction(action) ?? "add";
  };
  const resize = (value: number) => {
    const available = panel.current?.parentElement?.getBoundingClientRect().width ?? 600;
    setWidth(Math.max(300, Math.min(available - 300, value)));
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
      onClick={() => {
        restoreToggle.current = true;
        onToggle();
      }}
    >
      <Icon name={open ? "side-panel--close" : "side-panel--open"} />
    </button>
  );
  return (
    <>
      <aside
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
          aria-label={`Resize ${name.toLowerCase()} panel`}
          title={`Resize ${name.toLowerCase()} panel (Left/Right arrows)`}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              resize(
                (panel.current?.getBoundingClientRect().width ?? 300) +
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
            <div
              role="tablist"
              aria-label={`${name === "Files" ? "File" : name} tabs`}
              className="file-tabs"
            >
              {tabs.map((tab, index) => {
                const label = tab.label;
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: Child tabs provide equivalent keyboard reordering for this drag target.
                  <div
                    role="presentation"
                    key={tab.id}
                    className="file-tab"
                    data-selected={tab.id === selectedId}
                    draggable
                    onDragStart={(event) => {
                      drag.current = tab.id;
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", String(tab.id));
                    }}
                    onDragOver={(event) => {
                      if (drag.current !== null) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (drag.current === null) return;
                      const id = drag.current;
                      drag.current = null;
                      act({ type: "move", id, to: index });
                      setAnnouncement("Tab moved.");
                    }}
                    onDragEnd={() => {
                      drag.current = null;
                    }}
                  >
                    <button
                      ref={(element) => {
                        if (element) buttons.current.set(tab.id, element);
                        else buttons.current.delete(tab.id);
                      }}
                      type="button"
                      role="tab"
                      id={`${prefix}-tab-${tab.id}`}
                      aria-selected={tab.id === selectedId}
                      aria-controls={`${prefix}-content`}
                      tabIndex={tab.id === selectedId ? 0 : -1}
                      title={`${tab.title} (Delete to close; Alt+Left/Right to reorder)`}
                      onClick={() => onAction({ type: "select", id: tab.id })}
                      onKeyDown={(event) => {
                        const arrow =
                          event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
                        if (arrow && event.altKey) {
                          event.preventDefault();
                          act({ type: "move", id: tab.id, to: index + arrow });
                          setAnnouncement("Tab moved.");
                        } else if (arrow || event.key === "Home" || event.key === "End") {
                          event.preventDefault();
                          const target =
                            event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? tabs.length - 1
                                : (index + arrow + tabs.length) % tabs.length;
                          const next = tabs[target];
                          if (next) act({ type: "select", id: next.id });
                        } else if (event.key === "Delete") {
                          event.preventDefault();
                          act({ type: "close", id: tab.id });
                        }
                      }}
                    >
                      <Icon name={tab.icon} />
                      <span>{label}</span>
                    </button>
                    <button
                      type="button"
                      className="icon-button file-tab-close"
                      aria-label={`Close ${label}`}
                      onClick={() => act({ type: "close", id: tab.id })}
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                );
              })}
            </div>
            <button
              ref={add}
              type="button"
              className="icon-button"
              aria-label={`New ${name === "Files" ? "file" : name.toLowerCase()} tab`}
              title="New tab"
              onClick={() => act({ type: "add" })}
            >
              <Icon name="add" />
            </button>
          </div>
          {open && toggle}
        </div>
        <div
          className="file-panel-content"
          inert={!open}
          aria-hidden={!open}
          role="tabpanel"
          id={`${prefix}-content`}
          aria-labelledby={selected ? `${prefix}-tab-${selected.id}` : undefined}
          aria-label={selected ? undefined : emptyLabel}
        >
          {children(() => {
            focus.current = "active";
          })}
        </div>
        <span className="sr-only" role="status">
          {announcement}
        </span>
      </aside>
      {!open && toggle}
    </>
  );
}
