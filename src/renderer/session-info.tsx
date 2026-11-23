import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { defaultableSelections } from "../bridge/index.js";
import type { ModeChange, SessionState } from "../core/index.js";
import { AgentLogo } from "./agent-logo.js";
import { Icon } from "./icons.js";
import { menuAnchorMoved } from "./menu-anchor.js";
import { Button } from "./neobrutalism/button.js";
import { Toggle } from "./neobrutalism/toggle.js";

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
export function SessionOptionPicker({
  controls,
  source,
  confirmed,
  label,
  menuLabel,
  selected,
  tip,
  ended,
  editable,
  changing,
  onMode,
  sessionId,
  active = true,
  onSave,
  saveLabel,
}: {
  controls: NonNullable<SessionState["modes"]>["controls"];
  source: ModeChange["source"];
  confirmed: boolean;
  label: string;
  menuLabel: string;
  selected: string;
  tip: string;
  ended: boolean;
  editable: boolean;
  changing: boolean;
  onMode(change: ModeChange): void;
  sessionId: string;
  active?: boolean;
  onSave?: (() => void) | undefined;
  saveLabel?: string;
}) {
  const harnessMenu = label === "Harness mode";
  const Trigger = harnessMenu ? Button : "button";
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const modeKey = JSON.stringify([source, confirmed, controls]);
  const enabled =
    active && editable && !ended && !changing && !!controls.some((c) => c.options.length);
  const close = (restore = true) => {
    setOpen(false);
    if (restore) trigger.current?.focus();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: Session and capability changes must dismiss an existing menu.
  useEffect(() => {
    setOpen(false);
  }, [sessionId, active, editable, changing, ended, modeKey]);
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
    // Press feedback scales the trigger; its layout container is the stationary anchor.
    const anchorElement = button.parentElement ?? button;
    const anchor = anchorElement.getBoundingClientRect();
    (
      popup.querySelector<HTMLButtonElement>('[aria-checked="true"]') ??
      popup.querySelector<HTMLButtonElement>('[role="menuitemradio"]')
    )?.focus({ preventScroll: true });
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
      if (event.target instanceof Node && popup.contains(event.target)) return;
      if (menuAnchorMoved(anchorElement, anchor)) setOpen(false);
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
    <div className={label === "Model" ? "composer-model" : "session-option-picker"}>
      <Trigger
        ref={trigger}
        type="button"
        className="mode-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-disabled={!enabled}
        data-tooltip={tip}
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
      </Trigger>
      {changing && (
        <span className="sr-only" role="status">
          Changing session option…
        </span>
      )}
      {open && (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={menuLabel}
          popover="manual"
          className={harnessMenu ? "harness-mode-menu neo-dropdown-menu" : "harness-mode-menu"}
          onKeyDown={(event) => {
            const buttons = [
              ...(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []),
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
          {controls.map((control) => (
            <fieldset className="mode-menu-control" aria-label={control.name} key={control.id}>
              {controls.length > 1 && <div className="mode-menu-heading">{control.name}</div>}
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
                      aria-checked={confirmed && option.value === control.currentValue}
                      onClick={() => {
                        close();
                        onMode({
                          source,
                          configId: control.id,
                          value: option.value,
                        });
                      }}
                    >
                      <span>{option.name}</span>
                      {confirmed && option.value === control.currentValue && (
                        <Icon name="checkmark" />
                      )}
                    </button>
                  </div>
                );
              })}
            </fieldset>
          ))}
          {onSave && (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close();
                onSave();
              }}
            >
              {saveLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AutoApprovalToggle({
  enabled,
  active,
  save,
}: {
  enabled: boolean;
  active: boolean;
  save(value: boolean): Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  return (
    <>
      <Toggle
        aria-label="Code60 auto-approval"
        aria-pressed={enabled}
        disabled={!active || saving}
        data-tooltip="Auto-approve permission requests across all orchestration chats and their workers"
        onClick={async () => {
          setSaving(true);
          setError(false);
          try {
            await save(!enabled);
          } catch {
            setError(true);
          } finally {
            setSaving(false);
          }
        }}
      >
        <span>Code60 auto-approval</span>
        <span className="auto-approval-state" aria-hidden="true">
          {enabled ? "On" : "Off"}
        </span>
      </Toggle>
      {error && <span role="alert">Could not save Code60 auto-approval. Try again.</span>}
    </>
  );
}

/** Shared between all orchestrator and worker composers. Choices are connector-owned. */
export function SessionInfo({
  state,
  ended,
  editable,
  changing,
  autoApproval,
  onAutoApprovalChange,
  onMode,
  harness,
  sessionId,
  active = true,
  children,
  leading,
  onSaveDefault,
  sessionRole = "worker",
}: {
  state: SessionState | undefined;
  ended: boolean;
  editable: boolean;
  changing: boolean;
  autoApproval: boolean;
  onAutoApprovalChange?: ((value: boolean) => Promise<void>) | undefined;
  onMode(change: ModeChange): void;
  harness: string;
  sessionId: string;
  active?: boolean;
  children?: ReactNode;
  leading?: ReactNode;
  onSaveDefault?: () => void;
  sessionRole?: "orchestrator" | "worker";
}) {
  const modes = state?.modes;
  const settings = state?.settings;
  const selected = modes?.controls.length
    ? modes.confirmed
      ? modes.controls
          .map((c) => c.options.find((o) => o.value === c.currentValue)?.name ?? c.currentValue)
          .join(" · ")
      : "Unconfirmed"
    : "N/A";
  const historical = ended ? "Last reported · " : "";
  const model =
    settings && !settings.confirmed ? "Model unconfirmed" : (state?.model?.name ?? "N/A");
  const name = harnessNames[harness.toLowerCase()] ?? harness;
  const usage = state?.usage;
  const fraction = usage && usage.size > 0 ? Math.min(1, Math.max(0, usage.used / usage.size)) : 0;
  const contextTip = `${historical}Context: ${contextUsage(usage ?? null)}`;
  const unavailable = ended ? " · Last reported" : !editable ? " · Available after this turn" : "";
  const canSave =
    !!onSaveDefault && defaultableSelections(state).some((c) => c.category === "model");
  return (
    <section className="composer-footer session-info" aria-label="Session information">
      <div className="composer-mode">
        {leading}
        <SessionOptionPicker
          controls={modes?.controls ?? []}
          source={modes?.source ?? "config"}
          confirmed={modes?.confirmed ?? false}
          label="Harness mode"
          menuLabel="Harness modes"
          selected={selected}
          tip={`${historical}Harness mode: ${selected}${unavailable}`}
          {...{ ended, editable, changing, onMode, sessionId, active }}
        />
        {onAutoApprovalChange && (
          <AutoApprovalToggle enabled={autoApproval} active={active} save={onAutoApprovalChange} />
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
        <SessionOptionPicker
          controls={settings?.controls ?? []}
          source="config"
          confirmed={settings?.confirmed ?? false}
          label="Model"
          menuLabel="Model settings"
          selected={model}
          tip={`${historical}Model: ${model}${settings?.controls.length ? unavailable : " · Not advertised by this connector"}${changing ? " · Changing session option…" : ""}`}
          {...{ ended, editable, changing, onMode, sessionId, active }}
          onSave={canSave ? onSaveDefault : undefined}
          saveLabel={`Save as default for new ${sessionRole} sessions`}
        />
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
