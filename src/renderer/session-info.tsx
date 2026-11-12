import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ModeChange, SessionState } from "../core/index.js";
import { AgentLogo } from "./agent-logo.js";
import { Icon } from "./icons.js";

export function contextUsage(usage: SessionState["usage"]): string {
  if (!usage) return "N/A";
  const tokens = `${usage.used.toLocaleString()} / ${usage.size.toLocaleString()} tokens`;
  return usage.size > 0 ? `${tokens} (${((usage.used / usage.size) * 100).toFixed(1)}%)` : tokens;
}

const harnessNames: Record<string, string> = {
  droid: "Droid",
  claude: "Claude",
  codex: "Codex",
  copilot: "GitHub Copilot",
  kiro: "Kiro",
  opencode: "OpenCode",
  antigravity: "Antigravity",
};

/** Presentation only; the host remains responsible for validating every mode change. */
export function SessionInfo({
  state,
  ended,
  editable,
  changing,
  autoApproval,
  onMode,
  harness,
  sessionId,
  active = true,
  children,
  leading,
}: {
  state: SessionState | undefined;
  ended: boolean;
  editable: boolean;
  changing: boolean;
  autoApproval: boolean;
  onMode(change: ModeChange): void;
  harness: string;
  sessionId: string;
  active?: boolean;
  children?: ReactNode;
  leading?: ReactNode;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const modes = state?.modes;
  const enabled =
    active && editable && !ended && !changing && !!modes?.controls.some((c) => c.options.length);
  const selected =
    modes?.confirmed && modes.controls.length
      ? modes.controls
          .map((c) => c.options.find((o) => o.value === c.currentValue)?.name ?? c.currentValue)
          .join(" · ")
      : modes?.controls.length
        ? "Unconfirmed"
        : "N/A";
  const historical = ended ? "Last reported · " : "";
  const policy = `Code60 auto-approval: ${autoApproval ? "On" : "Off"}`;
  const modeTip = `${historical}Harness mode: ${selected} · ${policy}${changing ? " · Changing harness mode…" : ""}`;
  const model = state?.model?.name ?? "N/A";
  const name = harnessNames[harness.toLowerCase()] ?? harness;
  const usage = state?.usage;
  const fraction = usage && usage.size > 0 ? Math.min(1, Math.max(0, usage.used / usage.size)) : 0;
  const contextTip = `${historical}Context: ${contextUsage(usage ?? null)}`;
  const close = (restore = true) => {
    setOpen(false);
    if (restore) trigger.current?.focus();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: Session and capability changes must dismiss an existing menu.
  useEffect(() => {
    setOpen(false);
  }, [sessionId, active, editable, changing, ended, modes]);
  useLayoutEffect(() => {
    const popup = menu.current;
    const button = trigger.current;
    if (!open || !popup || !button) return;
    popup.showPopover();
    const place = () => {
      const rect = button.getBoundingClientRect();
      popup.style.maxHeight = `${Math.max(80, rect.top - 16)}px`;
      const box = popup.getBoundingClientRect();
      popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - box.width - 8))}px`;
      popup.style.top = `${Math.max(8, rect.top - box.height - 6)}px`;
    };
    place();
    (
      popup.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
      popup.querySelector<HTMLButtonElement>('[role="menuitemradio"]')
    )?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !popup.contains(event.target) &&
        !button.contains(event.target)
      ) {
        setOpen(false);
        if (popup.contains(document.activeElement)) button.focus();
      }
    };
    const leave = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !popup.contains(event.target) &&
        !button.contains(event.target)
      )
        setOpen(false);
    };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !popup.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("focusin", leave);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", place);
    return () => {
      popup.hidePopover();
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("focusin", leave);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);
  return (
    <section className="composer-footer session-info" aria-label="Session information">
      <div className="composer-mode">
        {leading}
        <button
          ref={trigger}
          type="button"
          className="mode-trigger"
          aria-label="Harness mode"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-disabled={!enabled}
          data-tooltip={modeTip}
          onClick={() => {
            if (enabled) setOpen((value) => !value);
          }}
          onKeyDown={(event) => {
            if (enabled && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
              event.preventDefault();
              setOpen(true);
            }
          }}
        >
          <span className="mode-value">{selected}</span>
          <Icon name="chevron--down" />
        </button>
        {changing && (
          <span className="sr-only" role="status">
            Changing harness mode…
          </span>
        )}
        {open && modes && (
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label="Harness modes"
            popover="manual"
            className="harness-mode-menu"
            onKeyDown={(event) => {
              const buttons = [
                ...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ??
                  []),
              ];
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                        buttons.length;
                buttons[next]?.focus();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              } else if (event.key === "Tab") close();
            }}
          >
            {modes.controls.map((control) => (
              <fieldset className="mode-menu-control" aria-label={control.name} key={control.id}>
                {modes.controls.length > 1 && (
                  <div className="mode-menu-heading">{control.name}</div>
                )}
                {control.options.map((option, index) => {
                  const previous = control.options[index - 1];
                  const groupStart =
                    option.group !== previous?.group || option.groupId !== previous?.groupId;
                  return (
                    <div key={option.value}>
                      {groupStart && option.group && (
                        <div className="mode-menu-heading">{option.group}</div>
                      )}
                      <button
                        type="button"
                        role="menuitemradio"
                        tabIndex={-1}
                        aria-checked={modes.confirmed && option.value === control.currentValue}
                        onClick={() => {
                          close();
                          onMode({
                            source: modes.source,
                            configId: control.id,
                            value: option.value,
                          });
                        }}
                      >
                        <span>{option.name}</span>
                        {modes.confirmed && option.value === control.currentValue && (
                          <Icon name="checkmark" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </fieldset>
            ))}
          </div>
        )}
      </div>
      <div className="composer-session-summary">
        <span
          className="context-donut"
          role="img"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access exposes the identifying tooltip.
          tabIndex={0}
          aria-label={contextTip}
          data-tooltip={contextTip}
          data-reported={!!usage}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <circle className="context-track" cx="10" cy="10" r="7" fill="none" strokeWidth="4" />
            <circle
              className="context-used"
              cx="10"
              cy="10"
              r="7"
              fill="none"
              strokeWidth="4"
              pathLength="100"
              strokeDasharray={`${fraction * 100} 100`}
              transform="rotate(-90 10 10)"
            />
          </svg>
        </span>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need the untruncated model tooltip. */}
        <span className="composer-model" tabIndex={0} data-tooltip={`${historical}Model: ${model}`}>
          {model}
        </span>
        <span
          className="composer-harness"
          role="img"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access exposes the identifying tooltip.
          tabIndex={0}
          aria-label={`Current provider: ${name}`}
          data-tooltip={`${historical}${name}`}
        >
          <AgentLogo id={harness} size={20} />
        </span>
        {children}
      </div>
    </section>
  );
}
