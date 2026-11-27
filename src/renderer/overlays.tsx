import {
  ActionableNotification,
  Button as CarbonButton,
  Layer,
  Search,
  ToastNotification,
} from "@carbon/react";
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icons.js";
import { Modal } from "./modal.js";
import { markParts, rankCommands } from "./palette.js";
import { captureTooltipScroll } from "./tooltip-scroll.js";

export interface Command {
  id: string;
  label: string;
  /** The page, run, or other context shown beside the label. */
  hint?: string;
  /** Keyboard shortcut shown at the right. */
  keys?: string;
  group: string;
  icon?: IconName;
  /** Shows a checkmark for the current appearance and similar toggles. */
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Why the command is unavailable. */
  reason?: string;
  run(): void;
}

const PAGE_STEP = 6;

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose(): void }) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const id = useId();
  const searching = query.trim() !== "";
  const matches = rankCommands(commands, query);
  const enabled = matches.filter((entry) => !entry.command.disabled);
  const activeIndex = enabled.length
    ? ((index % enabled.length) + enabled.length) % enabled.length
    : -1;
  const active = activeIndex >= 0 ? enabled[activeIndex]?.command : undefined;
  useEffect(() => {
    if (active)
      list.current
        ?.querySelector(`[id="${CSS.escape(`${id}-${active.id}`)}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, id]);
  const choose = (command: Command) => {
    if (command.disabled) return;
    onClose();
    command.run();
  };
  const clearQuery = () => {
    setQuery("");
    setIndex(0);
    input.current?.focus();
  };
  const groups = searching
    ? [{ name: "", entries: matches }]
    : [...new Set(matches.map((entry) => entry.command.group))].map((name) => ({
        name,
        entries: matches.filter((entry) => entry.command.group === name),
      }));
  return (
    <Modal
      title="Command palette"
      busy={false}
      onClose={onClose}
      initialFocus="input"
      passive
      className="command-palette"
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onKeyDown={(event) => {
        if (!enabled.length) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setIndex(
            (value) =>
              (value + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length,
          );
        } else if (event.key === "PageDown" || event.key === "PageUp") {
          event.preventDefault();
          setIndex((value) => {
            const current = ((value % enabled.length) + enabled.length) % enabled.length;
            return event.key === "PageDown"
              ? Math.min(enabled.length - 1, current + PAGE_STEP)
              : Math.max(0, current - PAGE_STEP);
          });
        } else if (event.key === "Enter" && active) {
          event.preventDefault();
          choose(active);
        }
      }}
    >
      <div className="command-palette-search">
        <Layer>
          <Search
            ref={input}
            id={`${id}-search`}
            size="lg"
            labelText="Search commands"
            placeholder="Search commands, pages, or actions…"
            closeButtonLabelText="Clear search"
            role="combobox"
            aria-label="Search commands"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={active ? `${id}-${active.id}` : undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onClear={() => {
              setQuery("");
              setIndex(0);
            }}
          />
        </Layer>
      </div>
      <div
        className="command-palette-list"
        role="listbox"
        aria-label="Commands"
        id={`${id}-list`}
        ref={list}
      >
        {groups.map((group) => {
          const options = group.entries.map(({ command, marks }) => {
            const context = [searching ? command.group : "", command.hint]
              .filter(Boolean)
              .join(" · ");
            const unavailableReason = command.disabled ? command.reason : undefined;
            return (
              <button
                key={command.id}
                id={`${id}-${command.id}`}
                type="button"
                role="option"
                className="command-palette-option"
                data-danger={command.danger || undefined}
                aria-selected={command === active}
                aria-disabled={command.disabled || undefined}
                aria-description={unavailableReason}
                title={unavailableReason}
                disabled={command.disabled}
                tabIndex={-1}
                onClick={() => choose(command)}
              >
                {command.icon ? (
                  <Icon name={command.icon} />
                ) : (
                  <span className="command-palette-icon-spacer" aria-hidden="true" />
                )}
                <span className="command-palette-label">
                  {markParts(command.label, marks).map((part) =>
                    part.marked ? (
                      <mark key={part.start}>{part.text}</mark>
                    ) : (
                      <Fragment key={part.start}>{part.text}</Fragment>
                    ),
                  )}
                </span>
                <span className="command-palette-meta">
                  {unavailableReason ? (
                    <span className="command-palette-reason">{unavailableReason}</span>
                  ) : (
                    context && <span className="command-palette-context">{context}</span>
                  )}
                  {command.checked && (
                    <Icon
                      name="checkmark"
                      className="command-palette-check"
                      aria-label="Current"
                      role="img"
                      aria-hidden={undefined}
                    />
                  )}
                  {command.keys && <kbd className="command-palette-kbd">{command.keys}</kbd>}
                </span>
              </button>
            );
          });
          return group.name ? (
            // biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics and its own frame to a row of buttons.
            <div
              className="command-palette-group"
              role="group"
              aria-labelledby={`${id}-group-${group.name}`}
              key={group.name}
            >
              <div className="command-palette-group-label" id={`${id}-group-${group.name}`}>
                {group.name}
              </div>
              {options}
            </div>
          ) : (
            <Fragment key="results">{options}</Fragment>
          );
        })}
        {!matches.length && (
          <div className="command-palette-empty">
            <p>No matching commands.</p>
            {searching && (
              <CarbonButton type="button" kind="tertiary" size="sm" onClick={clearQuery}>
                Clear search
              </CarbonButton>
            )}
          </div>
        )}
      </div>
      <footer className="command-palette-footer" data-searching={searching || undefined}>
        <div className="command-palette-hints" aria-hidden="true">
          <span>
            <kbd className="command-palette-kbd">↑</kbd>
            <kbd className="command-palette-kbd">↓</kbd> Move
          </span>
          <span>
            <kbd className="command-palette-kbd">Enter</kbd> Run
          </span>
          <span>
            <kbd className="command-palette-kbd">Esc</kbd> Close
          </span>
        </div>
        <span className="command-palette-count" aria-live="polite">
          {searching ? `${matches.length} ${matches.length === 1 ? "result" : "results"}` : ""}
        </span>
      </footer>
    </Modal>
  );
}

/** Non-interactive help remains available to assistive technology and described controls. */
export function ControlDescription({ id, children }: { id?: string; children: string }) {
  return (
    <span id={id} className="sr-only">
      {children}
    </span>
  );
}

type Tip = { text: string; keys: string | undefined; target: HTMLElement };

export function Tooltips() {
  const [tip, setTip] = useState<Tip>();
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let focusFrame: number | undefined;
    let focusing: HTMLElement | undefined;
    let scrollMoved: ((source: EventTarget | null) => boolean) | undefined;
    let described: HTMLElement | undefined;
    let previous: string | null = null;
    let hiddenAt = 0;
    const hide = () => {
      clearTimeout(timer);
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame);
      focusFrame = undefined;
      focusing = undefined;
      scrollMoved = undefined;
      if (described) {
        if (previous === null) described.removeAttribute("aria-describedby");
        else described.setAttribute("aria-describedby", previous);
        hiddenAt = Date.now();
      }
      described = undefined;
      setTip(undefined);
    };
    const show = (event: Event) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-tooltip], .icon-button[aria-label]")
          : null;
      if (target && target === described) return;
      hide();
      // A tooltip appearing mid-drag or mid-press would disturb the interaction.
      if (!target || target.matches(":disabled") || (event as PointerEvent).buttons) return;
      const text = target.dataset.tooltip ?? target.getAttribute("aria-label");
      if (!text) return;
      scrollMoved = captureTooltipScroll(target);
      const reveal = () => {
        previous = target.getAttribute("aria-describedby");
        described = target;
        target.setAttribute("aria-describedby", [previous, id].filter(Boolean).join(" "));
        setTip({ text, keys: target.dataset.tooltipKeys, target });
      };
      // Automatic focus scrolling is delivered before this frame's callbacks.
      // Reveal at its final position, without that same scroll dismissing it.
      if (event.type === "focusin") {
        focusing = target;
        focusFrame = requestAnimationFrame(() => {
          focusFrame = undefined;
          focusing = undefined;
          if (target.isConnected && document.activeElement === target) reveal();
        });
      } else if (Date.now() - hiddenAt < 300) reveal();
      else timer = setTimeout(reveal, 500);
    };
    const leave = (event: PointerEvent) => {
      if (
        described &&
        event.relatedTarget instanceof Node &&
        described.contains(event.relatedTarget)
      )
        return;
      hide();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const scroll = (event: Event) => {
      const moved = scrollMoved?.(event.target) ?? true;
      if (focusFrame !== undefined && focusing === document.activeElement) return;
      if (moved) hide();
    };
    document.addEventListener("pointerover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("pointerout", leave);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", hide);
    document.addEventListener("scroll", scroll, true);
    return () => {
      hide();
      document.removeEventListener("pointerover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", hide);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [id]);
  // Activity purposes can change while the pointer or keyboard focus stays on the status.
  const tipTarget = tip?.target;
  useEffect(() => {
    if (!tipTarget) return;
    const observer = new MutationObserver(() => {
      if (!tipTarget.isConnected) {
        setTip((current) => (current?.target === tipTarget ? undefined : current));
        return;
      }
      const text = tipTarget.dataset.tooltip ?? tipTarget.getAttribute("aria-label");
      setTip((current) => (current?.target === tipTarget && text ? { ...current, text } : current));
    });
    observer.observe(tipTarget, {
      attributes: true,
      attributeFilter: ["data-tooltip", "aria-label"],
    });
    if (tipTarget.parentElement) observer.observe(tipTarget.parentElement, { childList: true });
    return () => observer.disconnect();
  }, [tipTarget]);
  // Prefer above the control and flip below near the top edge; menu items get it beside the menu.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!tip || !element) return;
    element.showPopover();
    const control = tip.target.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const menu = tip.target.closest(".actions-menu")?.getBoundingClientRect();
    let left: number;
    let top: number;
    let side: string;
    if (menu) {
      side = "beside";
      left =
        menu.right + 8 + box.width > innerWidth - 8 ? menu.left - box.width - 8 : menu.right + 8;
      top = Math.min(innerHeight - box.height - 8, control.top);
    } else {
      side = control.top - box.height - 8 < 8 ? "below" : "above";
      left = Math.max(8, Math.min(control.left, innerWidth - box.width - 8));
      top = side === "below" ? control.bottom + 8 : control.top - box.height - 8;
    }
    element.dataset.side = side;
    element.style.left = `${Math.max(8, left)}px`;
    element.style.top = `${Math.max(8, top)}px`;
    const stem = control.left + control.width / 2 - Math.max(8, left) - 1;
    element.style.setProperty("--stem", `${Math.max(6, Math.min(box.width - 8, stem))}px`);
  }, [tip]);
  return tip ? (
    <div ref={ref} id={id} role="tooltip" popover="manual" className="app-tooltip">
      <span>{tip.text}</span>
      {tip.keys && <kbd>{tip.keys}</kbd>}
    </div>
  ) : null;
}

export type ToastTone = "info" | "success" | "warning" | "error";
export interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
  action?: { label: string; run(): void } | undefined;
}
const tones: Record<ToastTone, { kind: string; duration: number | null }> = {
  info: { kind: "Note", duration: 4000 },
  success: { kind: "Done", duration: 6000 },
  warning: { kind: "Warning", duration: 8000 },
  error: { kind: "Error", duration: null },
};
/** At most three toasts remain; a new one displaces the oldest, errors included. */
export const maxToasts = 3;

export function Toasts({
  messages,
  onDismiss,
}: {
  messages: ToastMessage[];
  onDismiss(id: number): void;
}) {
  const latest = messages.at(-1);
  return (
    <section className="toast-stack" aria-label="Notifications">
      <div className="sr-only" role="status" aria-live="polite">
        {latest && latest.tone !== "error" ? `${tones[latest.tone].kind}: ${latest.text}` : ""}
      </div>
      {messages.map((message) => (
        <Toast key={message.id} message={message} onDismiss={onDismiss} />
      ))}
    </section>
  );
}
function Toast({ message, onDismiss }: { message: ToastMessage; onDismiss(id: number): void }) {
  const tone = tones[message.tone];
  const [paused, setPaused] = useState(false);
  const remaining = useRef(tone.duration ?? 0);
  useEffect(() => {
    if (paused || tone.duration === null) return;
    const started = Date.now();
    const timer = setTimeout(() => onDismiss(message.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [message.id, onDismiss, paused, tone.duration]);
  const notification = {
    title: tone.kind,
    subtitle: message.text,
    kind: message.tone,
    "aria-label": "Dismiss notification",
    role: message.tone === "error" ? ("alert" as const) : ("log" as const),
    "aria-live": message.tone === "error" ? ("assertive" as const) : ("off" as const),
    onClose: () => {
      onDismiss(message.id);
      return false;
    },
  };
  return (
    <fieldset
      aria-label={`${tone.kind} notification`}
      className="carbon-toast-owner"
      data-paused={paused}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onDismiss(message.id);
        }
      }}
    >
      {message.action ? (
        <ActionableNotification
          {...notification}
          actionButtonLabel={message.action.label}
          onActionButtonClick={() => {
            message.action?.run();
            onDismiss(message.id);
          }}
        />
      ) : (
        <ToastNotification {...notification} />
      )}
    </fieldset>
  );
}
