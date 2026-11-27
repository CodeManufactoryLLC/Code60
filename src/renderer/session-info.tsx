import { Menu, MenuItem, MenuItemRadioGroup } from "@carbon/react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { defaultableSelections } from "../bridge/index.js";
import type { ModeChange, SessionState } from "../core/index.js";
import { AgentLogo } from "./agent-logo.js";
import { Button as AppButton } from "./carbon/button.js";
import { Icon } from "./icons.js";
import { menuAnchorMoved } from "./menu-anchor.js";

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
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
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
    // Press feedback scales the trigger; its layout container is the stationary anchor.
    const anchorElement = button.parentElement ?? button;
    const anchor = anchorElement.getBoundingClientRect();
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
    const resize = () => setOpen(false);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("focusin", leave);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [open]);
  return (
    <div className={label === "Model" ? "composer-model" : "session-option-picker"}>
      <AppButton
        ref={trigger}
        type="button"
        className="mode-trigger"
        variant="quiet"
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
      </AppButton>
      {changing && (
        <span className="sr-only" role="status">
          Changing session option…
        </span>
      )}
      {open && (
        <Menu
          ref={menu}
          id={id}
          open
          label={menuLabel}
          onClose={() => close()}
          x={trigger.current?.getBoundingClientRect().left ?? 0}
          y={[
            trigger.current?.getBoundingClientRect().top ?? 0,
            trigger.current?.getBoundingClientRect().bottom ?? 0,
          ]}
          onKeyDownCapture={(event) => {
            if (event.key !== "Home" && event.key !== "End") return;
            const items = menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]');
            const item = event.key === "Home" ? items?.[0] : items?.[items.length - 1];
            if (item) {
              event.preventDefault();
              event.stopPropagation();
              item.focus();
            }
          }}
        >
          {controls.map((control) => (
            <MenuItemRadioGroup
              key={control.id}
              label={control.name}
              items={control.options.map((option) => option.value)}
              selectedItem={confirmed ? control.currentValue : null}
              itemToString={(value) => {
                const option = control.options.find((option) => option.value === value);
                return option
                  ? [option.group, option.name].filter(Boolean).join(" / ")
                  : String(value);
              }}
              onChange={(value) => {
                close();
                onMode({ source, configId: control.id, value: String(value) });
              }}
            />
          ))}
          {onSave && (
            <MenuItem
              label={saveLabel ?? "Save default"}
              onClick={() => {
                close();
                onSave();
              }}
            />
          )}
        </Menu>
      )}
    </div>
  );
}

/** Shared between all orchestrator and worker composers. Choices are connector-owned. */
export function SessionInfo({
  harness,
  state,
  ended,
  editable,
  changing,
  onMode,
  sessionId,
  active = true,
  onSaveDefault,
  sessionRole = "worker",
}: {
  harness?: string | undefined;
  state: SessionState | undefined;
  ended: boolean;
  editable: boolean;
  changing: boolean;
  onMode(change: ModeChange): void;
  sessionId: string;
  active?: boolean;
  onSaveDefault?: (() => void) | undefined;
  sessionRole?: "orchestrator" | "worker";
}) {
  const harnessName = harness ? (harnessNames[harness.toLowerCase()] ?? harness) : undefined;
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
  const usage = state?.usage;
  const fraction = usage && usage.size > 0 ? Math.min(1, Math.max(0, usage.used / usage.size)) : 0;
  const contextTip = `${historical}Context: ${contextUsage(usage ?? null)}`;
  const unavailable = ended ? " · Last reported" : !editable ? " · Available after this turn" : "";
  const canSave =
    !!onSaveDefault && defaultableSelections(state).some((c) => c.category === "model");
  return (
    <section className="chat-prompt-controls" aria-label="Session information">
      {harness && harnessName && (
        <span
          className="composer-harness"
          role="img"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access exposes the identifying tooltip.
          tabIndex={0}
          aria-label={`Current provider: ${harnessName}`}
          data-tooltip={`${ended ? "Last reported · " : ""}${harnessName}`}
        >
          <AgentLogo id={harness} size={20} />
        </span>
      )}
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
        controls={modes?.controls ?? []}
        source={modes?.source ?? "config"}
        confirmed={modes?.confirmed ?? false}
        label="Harness mode"
        menuLabel="Harness modes"
        selected={selected}
        tip={`${historical}Harness mode: ${selected}${unavailable}`}
        {...{ ended, editable, changing, onMode, sessionId, active }}
      />
    </section>
  );
}
