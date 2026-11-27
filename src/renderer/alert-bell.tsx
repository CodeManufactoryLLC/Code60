import { Checkmark, Close, DotMark, Notification } from "@carbon/icons-react";
import { Button } from "@carbon/react";
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AlertRecord, AlertSeverity } from "../bridge/index.js";
import { formatAlertTime } from "./alerts.js";
import { Icon, type IconName } from "./icons.js";

export interface HeaderAlertsProps {
  items: readonly AlertRecord[];
  unreadCount: number;
  error?: string;
  onOpenAlert(alert: AlertRecord): void;
  onMarkRead(id: string): void;
  onMarkUnread(id: string): void;
  onMarkAllRead(): void;
  onDismiss(id: string): void;
  onClearRead(): void;
}

function severityIcon(severity: AlertSeverity): IconName {
  switch (severity) {
    case "error":
      return "error";
    case "warning":
      return "warning--alt--filled";
    case "info":
      return "information";
  }
}

export function formatAlertBadge(unreadCount: number): string | null {
  if (unreadCount <= 0) return null;
  return unreadCount > 99 ? "99+" : String(unreadCount);
}

export function AlertBellButton({
  triggerRef,
  unreadCount,
  open,
  panelId,
  onToggle,
}: {
  triggerRef: RefObject<HTMLButtonElement | null>;
  unreadCount: number;
  open: boolean;
  panelId: string;
  onToggle(): void;
}) {
  const badge = formatAlertBadge(unreadCount);
  const label = unreadCount > 0 ? `Alerts (${unreadCount} unread)` : "Alerts";
  return (
    <Button
      ref={triggerRef}
      size="md"
      kind="ghost"
      className="alert-bell-trigger"
      aria-label={label}
      title={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={onToggle}
    >
      <span className="alert-bell-icon">
        <Notification size={16} aria-hidden="true" />
        {badge && (
          <span className="alert-bell-badge" aria-hidden="true">
            {badge}
          </span>
        )}
      </span>
    </Button>
  );
}

export function AlertPopover({
  panelId,
  triggerRef,
  alerts,
  onClose,
}: {
  panelId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  alerts: HeaderAlertsProps;
  onClose(): void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [position, setPosition] = useState<{ top: number; right: number }>({ top: 52, right: 8 });

  useLayoutEffect(() => {
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const right = Math.max(8, window.innerWidth - rect.right);
      const top = Math.max(8, rect.bottom + 4);
      setPosition({ top, right });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [triggerRef]);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (panelRef.current?.contains(target) || triggerRef.current?.contains(target))
      ) {
        return;
      }
      closeRef.current();
    };
    const onBlur = () => closeRef.current();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [triggerRef]);

  const hasRead = alerts.items.some((item) => item.read);

  return (
    <div
      ref={panelRef}
      id={panelId}
      className="alert-popover"
      role="dialog"
      aria-label="Alerts"
      tabIndex={-1}
      style={{ top: `${position.top}px`, right: `${position.right}px` }}
    >
      <div className="alert-popover-header">
        <h2 className="alert-popover-title">Alerts</h2>
        <div className="alert-popover-actions">
          {alerts.unreadCount > 0 && (
            <Button size="sm" kind="ghost" onClick={alerts.onMarkAllRead}>
              Mark all read
            </Button>
          )}
          {hasRead && (
            <Button size="sm" kind="ghost" onClick={alerts.onClearRead}>
              Clear read
            </Button>
          )}
        </div>
      </div>
      {alerts.error && (
        <p className="alert-popover-error" role="alert">
          {alerts.error}
        </p>
      )}
      {alerts.items.length === 0 ? (
        <p className="alert-empty">No alerts.</p>
      ) : (
        <ul className="alert-list">
          {alerts.items.map((alert) => (
            <li
              key={alert.id}
              className="alert-item"
              data-read={alert.read}
              data-severity={alert.severity}
            >
              <button
                type="button"
                className="alert-item-link"
                onClick={() => {
                  onClose();
                  alerts.onOpenAlert(alert);
                }}
              >
                <span className="alert-item-leading" aria-hidden="true">
                  <span className="alert-item-dot" />
                  <Icon
                    name={severityIcon(alert.severity)}
                    className={`alert-item-severity alert-item-severity--${alert.severity}`}
                  />
                </span>
                <span className="alert-item-body">
                  <span className="alert-item-title">{alert.title}</span>
                  {alert.detail && <span className="alert-item-detail">{alert.detail}</span>}
                  <span className="alert-item-meta">
                    {alert.read ? "Read" : "Unread"} · {formatAlertTime(alert.updatedAt)}
                  </span>
                </span>
              </button>
              <div className="alert-item-controls">
                <button
                  type="button"
                  className="icon-button alert-item-action"
                  aria-label={
                    alert.read ? `Mark "${alert.title}" unread` : `Mark "${alert.title}" read`
                  }
                  title={alert.read ? "Mark unread" : "Mark read"}
                  onClick={() =>
                    alert.read ? alerts.onMarkUnread(alert.id) : alerts.onMarkRead(alert.id)
                  }
                >
                  {alert.read ? (
                    <DotMark size={16} aria-hidden="true" />
                  ) : (
                    <Checkmark size={16} aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  className="icon-button alert-item-action"
                  aria-label={`Dismiss "${alert.title}"`}
                  title="Dismiss"
                  onClick={() => alerts.onDismiss(alert.id)}
                >
                  <Close size={16} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
