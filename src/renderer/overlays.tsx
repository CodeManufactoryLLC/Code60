import {
  type CSSProperties,
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Icon, type IconName } from "./icons.js";
import { markParts, rankCommands } from "./palette.js";

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

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const id = useId();
  const searching = query.trim() !== "";
  const matches = rankCommands(commands, query);
  const enabled = matches.filter((entry) => !entry.command.disabled);
  const active = enabled[index % Math.max(1, enabled.length)]?.command;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    input.current?.focus();
    return () => previous?.focus();
  }, []);
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
  const groups = searching
    ? [{ name: "", entries: matches }]
    : [...new Set(matches.map((entry) => entry.command.group))].map((name) => ({
        name,
        entries: matches.filter((entry) => entry.command.group === name),
      }));
  return (
    <dialog
      ref={dialog}
      className="command-palette"
      aria-label="Command palette"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setIndex(
            (value) =>
              (value + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) %
              Math.max(1, enabled.length),
          );
        } else if (event.key === "Enter" && active) {
          event.preventDefault();
          choose(active);
        }
      }}
    >
      <div className="palette-input">
        <Icon name="chevron--right" />
        <input
          ref={input}
          role="combobox"
          aria-label="Search commands"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={active ? `${id}-${active.id}` : undefined}
          placeholder="Type a command, page, or run…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
        />
      </div>
      <div role="listbox" aria-label="Commands" id={`${id}-list`} ref={list}>
        {groups.map((group) => {
          const options = group.entries.map(({ command, marks }) => (
            <button
              key={command.id}
              id={`${id}-${command.id}`}
              type="button"
              role="option"
              className={command.danger ? "danger-text" : undefined}
              aria-selected={command === active}
              aria-disabled={command.disabled || undefined}
              disabled={command.disabled}
              tabIndex={-1}
              onClick={() => choose(command)}
            >
              {command.icon ? <Icon name={command.icon} /> : <span />}
              <span className="option-label">
                {markParts(command.label, marks).map((part) =>
                  part.marked ? (
                    <mark key={part.start}>{part.text}</mark>
                  ) : (
                    <Fragment key={part.start}>{part.text}</Fragment>
                  ),
                )}
              </span>
              <span className="command-hint">
                {[searching ? command.group : "", command.hint].filter(Boolean).join(" / ")}
              </span>
              {command.checked ? (
                <Icon name="checkmark" aria-label="Current" role="img" aria-hidden={undefined} />
              ) : (
                <span className="command-hint">{command.keys}</span>
              )}
            </button>
          ));
          return group.name ? (
            // biome-ignore lint/a11y/useSemanticElements: a fieldset would add form semantics and its own frame to a row of buttons.
            <div role="group" aria-labelledby={`${id}-group-${group.name}`} key={group.name}>
              <div className="palette-group" id={`${id}-group-${group.name}`}>
                {group.name}
              </div>
              {options}
            </div>
          ) : (
            <Fragment key="results">{options}</Fragment>
          );
        })}
        {!matches.length && <p className="palette-empty">No matching commands.</p>}
      </div>
      <footer>
        <span>
          <kbd>↑</kbd> <kbd>↓</kbd> Move
        </span>
        <span>
          <kbd>Enter</kbd> Run
        </span>
        <span>
          <kbd>Esc</kbd> Close
        </span>
        <span className="palette-count" aria-live="polite">
          {matches.length} {matches.length === 1 ? "result" : "results"}
        </span>
      </footer>
    </dialog>
  );
}

/**
 * An information button whose tooltip holds a setting's explanation. The hidden copy keeps the
 * explanation available to controls that reference `id` with aria-describedby.
 */
export function InfoTip({ label, id, children }: { label: string; id?: string; children: string }) {
  return (
    <>
      <button
        type="button"
        className="icon-button info-tip"
        aria-label={`About ${label}`}
        data-tooltip={children}
        // Pressing hides tooltips; refocusing shows this one again for pointer and touch users.
        onClick={(event) => {
          event.currentTarget.blur();
          event.currentTarget.focus();
        }}
      >
        <Icon name="information" />
      </button>
      {id && (
        <span id={id} hidden>
          {children}
        </span>
      )}
    </>
  );
}

type Tip = { text: string; keys: string | undefined; target: HTMLElement };

export function Tooltips() {
  const [tip, setTip] = useState<Tip>();
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let described: HTMLElement | undefined;
    let previous: string | null = null;
    let hiddenAt = 0;
    const hide = () => {
      clearTimeout(timer);
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
      const reveal = () => {
        previous = target.getAttribute("aria-describedby");
        described = target;
        target.setAttribute("aria-describedby", [previous, id].filter(Boolean).join(" "));
        setTip({ text, keys: target.dataset.tooltipKeys, target });
      };
      // Keyboard focus and a quick move from another tooltip show it at once.
      if (event.type === "focusin" || Date.now() - hiddenAt < 300) reveal();
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
    document.addEventListener("pointerover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("pointerout", leave);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", hide);
    document.addEventListener("scroll", hide, true);
    return () => {
      hide();
      document.removeEventListener("pointerover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", hide);
      document.removeEventListener("scroll", hide, true);
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
const tones: Record<ToastTone, { kind: string; icon: IconName; duration: number | null }> = {
  info: { kind: "Note", icon: "information", duration: 4000 },
  success: { kind: "Done", icon: "checkmark--outline", duration: 6000 },
  warning: { kind: "Warning", icon: "warning--alt", duration: 8000 },
  error: { kind: "Error", icon: "error", duration: null },
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
  return (
    <fieldset
      aria-label={`${tone.kind} notification`}
      className="app-toast"
      data-tone={message.tone}
      data-paused={paused}
      role={message.tone === "error" ? "alert" : undefined}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onDismiss(message.id);
      }}
    >
      <Icon name={tone.icon} />
      <span className="toast-body">
        <span className="toast-kind">{tone.kind}</span>
        <span>{message.text}</span>
        {message.action && (
          <span className="toast-actions">
            <button
              type="button"
              onClick={() => {
                message.action?.run();
                onDismiss(message.id);
              }}
            >
              {message.action.label}
            </button>
          </span>
        )}
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(message.id)}
      >
        <Icon name="close" />
      </button>
      {tone.duration !== null && (
        <span
          className="toast-timer"
          aria-hidden="true"
          style={{ "--duration": `${tone.duration}ms` } as CSSProperties}
        />
      )}
    </fieldset>
  );
}
