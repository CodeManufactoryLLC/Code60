// Adapted from neobrutalism.dev's Popover + Command composition; see README.md.
import {
  type KeyboardEventHandler,
  type ReactNode,
  type RefObject,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons.js";
import { clampMenuPosition, menuAnchorMoved, scrollMenuOption } from "../menu-anchor.js";
import { menuTypeahead } from "../menu-typeahead.js";

interface ComboboxOption {
  id: string;
  label: string;
  title?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

/** Native popover dismissal with a select-only, keyboard-operated listbox. */
export function Combobox({
  label,
  value,
  options,
  disabled = false,
  onSelect,
  triggerRef,
  onTriggerKeyDown,
  listLabel = "Current page and parents",
  placeholder = "",
  preserveCase = false,
}: {
  label: string;
  value: string;
  options: readonly ComboboxOption[];
  disabled?: boolean;
  onSelect(id: string): void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  onTriggerKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  listLabel?: string;
  placeholder?: string;
  preserveCase?: boolean;
}) {
  const id = useId();
  const localTrigger = useRef<HTMLButtonElement>(null);
  const trigger = triggerRef ?? localTrigger;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const previousValue = useRef(value);
  useLayoutEffect(() => {
    if (disabled || previousValue.current !== value) setOpen(false);
    previousValue.current = value;
  }, [value, disabled]);
  const selected = options.find((option) => option.id === value);
  const expanded = open && !disabled;
  const close = (restore = false) => {
    setOpen(false);
    if (restore) trigger.current?.focus({ preventScroll: true });
  };
  const expand = () => {
    setMounted(true);
    setOpen(true);
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        className="neo-combobox-trigger"
        aria-label={label}
        title={selected?.title ?? selected?.label ?? placeholder}
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        disabled={disabled}
        onClick={() => (expanded ? close() : expand())}
        onKeyDown={(event) => {
          onTriggerKeyDown?.(event);
          if (event.defaultPrevented) return;
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          expand();
        }}
      >
        {selected?.icon}
        <span className="page-title-text">{selected?.label ?? placeholder}</span>
        <Icon name="chevron--down" />
      </button>
      {mounted && (
        <ComboboxPopup
          id={id}
          label={listLabel}
          preserveCase={preserveCase}
          open={expanded}
          anchor={trigger.current}
          value={value}
          options={options}
          onClose={close}
          onSelect={(id) => {
            close(true);
            if (id !== value) onSelect(id);
          }}
        />
      )}
    </>
  );
}

function ComboboxPopup({
  preserveCase,
  id,
  label,
  open,
  anchor,
  value,
  options,
  onClose,
  onSelect,
}: {
  preserveCase: boolean;
  id: string;
  label: string;
  open: boolean;
  anchor: HTMLButtonElement | null;
  value: string;
  options: readonly ComboboxOption[];
  onClose(restore?: boolean): void;
  onSelect(id: string): void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(value);
  const close = useRef(onClose);
  close.current = onClose;
  const enabled = options.filter((option) => !option.disabled);
  const highlighted = enabled.find((option) => option.id === active) ?? enabled[0];
  const optionId = (option: ComboboxOption) => `${id}-${encodeURIComponent(option.id)}`;

  useLayoutEffect(() => {
    const element = popup.current;
    if (!element || !anchor) return;
    if (!open) {
      if (element.matches(":popover-open")) element.hidePopover();
      return;
    }
    setActive(value);
    const bounds = anchor.getBoundingClientRect();
    element.showPopover();
    const position = clampMenuPosition(bounds.left, bounds.bottom + 6, {
      width: element.offsetWidth,
      height: element.offsetHeight,
    });
    element.style.left = `${position.left}px`;
    element.style.top = `${position.top}px`;
    list.current?.focus({ preventScroll: true });
    // Delegated press feedback scales the button; compare its stationary wrapper.
    const anchorElement = anchor.parentElement ?? anchor;
    const anchorBounds = anchorElement.getBoundingClientRect();
    const dismiss = () => close.current();
    const scroll = (event: Event) => {
      if (event.target instanceof Node && element.contains(event.target)) return;
      if (menuAnchorMoved(anchorElement, anchorBounds)) dismiss();
    };
    const visibility = () => {
      if (document.visibilityState !== "visible") dismiss();
    };
    const observer = new MutationObserver(() => {
      if (anchor.closest("[hidden], [inert]")) dismiss();
    });
    for (let parent: HTMLElement | null = anchor; parent; parent = parent.parentElement)
      observer.observe(parent, { attributes: true, attributeFilter: ["hidden", "inert"] });
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    window.addEventListener("scroll", scroll, true);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
      window.removeEventListener("scroll", scroll, true);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [anchor, open, value]);
  const highlightedId = highlighted ? optionId(highlighted) : undefined;
  useLayoutEffect(() => {
    const option = highlightedId ? document.getElementById(highlightedId) : null;
    if (open && list.current && option) scrollMenuOption(list.current, option);
  }, [open, highlightedId]);

  return createPortal(
    <div
      ref={popup}
      popover="auto"
      className="neo-combobox-popup"
      data-preserve-case={preserveCase || undefined}
      aria-hidden={!open || undefined}
      inert={!open}
      onBeforeToggle={(event) => {
        if (event.newState === "closed") close.current();
      }}
    >
      <div
        ref={list}
        id={id}
        role="listbox"
        tabIndex={-1}
        aria-label={label}
        aria-activedescendant={open && highlighted ? optionId(highlighted) : undefined}
        className="neo-combobox-list"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            onClose(true);
          } else if (event.key === "Tab") {
            onClose(true);
          } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const index = enabled.findIndex((option) => option.id === highlighted?.id);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? enabled.length - 1
                  : (index + (event.key === "ArrowDown" ? 1 : enabled.length - 1)) % enabled.length;
            const option = enabled[next];
            if (option) setActive(option.id);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (highlighted) onSelect(highlighted.id);
          } else if (/^\p{L}$/u.test(event.key) && !event.metaKey && !event.ctrlKey) {
            const index = enabled.findIndex((option) => option.id === highlighted?.id);
            const next = menuTypeahead(
              enabled.map((option) => ({ ...option, textContent: option.label })),
              index,
              event.key,
            );
            if (next) {
              event.preventDefault();
              setActive(next.id);
            }
          }
        }}
      >
        {options.map((option) => (
          <button
            type="button"
            tabIndex={-1}
            key={option.id}
            id={optionId(option)}
            role="option"
            title={option.title ?? option.label}
            aria-selected={option.id === value}
            aria-disabled={option.disabled || undefined}
            data-active={highlighted?.id === option.id || undefined}
            className="neo-combobox-option"
            onPointerMove={() => {
              if (!option.disabled) setActive(option.id);
            }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!option.disabled) onSelect(option.id);
            }}
          >
            {option.icon}
            <span>{option.label}</span>
            {option.id === value && <Icon name="checkmark" />}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
