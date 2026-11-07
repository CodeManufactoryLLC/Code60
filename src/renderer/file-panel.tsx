import { type CSSProperties, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { type FileTabAction, type FileTabs, fileTabLabel, updateFileTabs } from "./file-tabs.js";
import { type FileBrowser, FileInspector, FilesPage } from "./files.js";
import { Icon } from "./icons.js";
import type { PreviewViewState } from "./monaco-preview.js";

export function FilePanel({
  tabs,
  onAction,
  browser,
  open,
  active,
  onOpenProject,
  onToggle,
}: {
  tabs: FileTabs;
  onAction(action: FileTabAction): void;
  browser: FileBrowser;
  open: boolean;
  active: boolean;
  onOpenProject(): void;
  onToggle(): void;
}) {
  const prefix = useId();
  const panel = useRef<HTMLElement>(null);
  const [resizing, setResizing] = useState(false);
  const [width, setWidth] = useState<number>();
  const [hiddenFiles, setHiddenFiles] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const add = useRef<HTMLButtonElement>(null);
  const focus = useRef<number | "add" | null>(null);
  const drag = useRef<number | null>(null);
  const views = useRef(new Map<number, { current: PreviewViewState | null }>());
  const selected = tabs.entries.find((tab) => tab.id === tabs.active);
  if (selected?.kind === "file" && !views.current.has(selected.id))
    views.current.set(selected.id, { current: null });

  useEffect(() => {
    for (const id of views.current.keys()) {
      if (!tabs.entries.some((tab) => tab.id === id)) views.current.delete(id);
    }
  }, [tabs.entries]);
  useLayoutEffect(() => {
    if (!active || !open) return;
    if (focus.current === "add") add.current?.focus();
    else if (focus.current !== null) buttons.current.get(focus.current)?.focus();
    focus.current = null;
    buttons.current.get(tabs.active ?? -1)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tabs, active, open]);

  const act = (action: FileTabAction) => {
    const next = updateFileTabs(tabs, action);
    focus.current = next.active ?? "add";
    onAction(action);
  };
  const resize = (value: number) => {
    const available = panel.current?.parentElement?.getBoundingClientRect().width ?? 600;
    setWidth(Math.max(300, Math.min(available - 300, value)));
  };
  return (
    <aside
      ref={panel}
      id="chat-file-panel"
      className="file-panel"
      aria-label="Files panel"
      data-minimized={!open}
      data-resizing={resizing}
      style={
        width === undefined ? undefined : ({ "--file-panel-width": `${width}px` } as CSSProperties)
      }
    >
      <button
        type="button"
        className="file-column-resize"
        aria-label="Resize files panel"
        title="Resize files panel (Left/Right arrows)"
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
          <div role="tablist" aria-label="File tabs" className="file-tabs">
            {tabs.entries.map((tab, index) => {
              const label = fileTabLabel(tab, tabs.entries);
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: Child tabs provide equivalent keyboard reordering for this drag target.
                <div
                  role="presentation"
                  key={tab.id}
                  className="file-tab"
                  data-selected={tab.id === tabs.active}
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
                    aria-selected={tab.id === tabs.active}
                    aria-controls={`${prefix}-content`}
                    tabIndex={tab.id === tabs.active ? 0 : -1}
                    title={`${tab.kind === "file" ? tab.path : label} (Delete to close; Alt+Left/Right to reorder)`}
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
                              ? tabs.entries.length - 1
                              : (index + arrow + tabs.entries.length) % tabs.entries.length;
                        const next = tabs.entries[target];
                        if (next) act({ type: "select", id: next.id });
                      } else if (event.key === "Delete") {
                        event.preventDefault();
                        act({ type: "close", id: tab.id });
                      }
                    }}
                  >
                    <Icon name={tab.kind === "explorer" ? "folder" : "document"} />
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
            aria-label="New file tab"
            title="New tab"
            onClick={() => act({ type: "blank" })}
          >
            <Icon name="add" />
          </button>
        </div>
        <button
          type="button"
          className="icon-button file-panel-toggle"
          aria-label="Toggle files panel"
          title={open ? "Minimize files panel" : "Expand files panel"}
          aria-expanded={open}
          aria-controls={`${prefix}-content`}
          onClick={onToggle}
        >
          <Icon name={open ? "side-panel--close" : "side-panel--open"} />
        </button>
      </div>
      <div
        className="file-panel-content"
        inert={!open}
        aria-hidden={!open}
        role="tabpanel"
        id={`${prefix}-content`}
        aria-labelledby={selected ? `${prefix}-tab-${selected.id}` : undefined}
        aria-label={selected ? undefined : "Open files"}
      >
        {!selected || selected.kind === "blank" ? (
          <div className="file-panel-empty">
            <button
              type="button"
              className="file-open-link"
              onClick={() => act({ type: "explorer" })}
            >
              Open Files
            </button>
          </div>
        ) : selected.kind === "explorer" ? (
          <FilesPage
            key={selected.id}
            browser={browser}
            onOpenProject={onOpenProject}
            active={active && open}
            hidden={hiddenFiles}
            onHidden={setHiddenFiles}
            onOpenFile={(path) => {
              browser.selectFile(path);
              act({ type: "file", path });
            }}
          />
        ) : active && open ? (
          <FileInspector
            key={selected.id}
            browser={browser}
            viewState={views.current.get(selected.id)}
          />
        ) : null}
      </div>
      <span className="sr-only" role="status">
        {announcement}
      </span>
    </aside>
  );
}
