import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AlertRecord } from "../bridge/index.js";
import { AlertBellButton, AlertPopover, formatAlertBadge } from "./alert-bell.js";

const sampleAlerts: AlertRecord[] = [
  {
    id: "550e8400-e29b-41d4-a716-446655440001",
    source: "approval",
    severity: "warning",
    title: "Approval needed: Relay",
    detail: "Run npm test",
    target: { kind: "conversation", id: "relay-1" },
    read: false,
    createdAt: "2026-11-27T10:00:00.000Z",
    updatedAt: "2026-11-27T10:00:00.000Z",
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440002",
    source: "automation",
    severity: "error",
    title: "Scheduled job failed: Nightly",
    target: { kind: "page", id: "automations" },
    read: true,
    createdAt: "2026-11-27T09:00:00.000Z",
    updatedAt: "2026-11-27T09:00:00.000Z",
  },
];

describe("AlertBellButton and AlertPopover", () => {
  it("formats unread badge counts cleanly with 99+ cap", () => {
    expect(formatAlertBadge(0)).toBeNull();
    expect(formatAlertBadge(1)).toBe("1");
    expect(formatAlertBadge(99)).toBe("99");
    expect(formatAlertBadge(100)).toBe("99+");
  });

  it("renders the header bell trigger with and without an unread badge", () => {
    const emptyHtml = renderToStaticMarkup(
      <AlertBellButton
        triggerRef={createRef()}
        unreadCount={0}
        open={false}
        panelId="alerts-panel"
        onToggle={() => {}}
      />,
    );
    expect(emptyHtml).toContain('aria-label="Alerts"');
    expect(emptyHtml).not.toContain("alert-bell-badge");

    const unreadHtml = renderToStaticMarkup(
      <AlertBellButton
        triggerRef={createRef()}
        unreadCount={3}
        open={true}
        panelId="alerts-panel"
        onToggle={() => {}}
      />,
    );
    expect(unreadHtml).toContain('aria-label="Alerts (3 unread)"');
    expect(unreadHtml).toContain('aria-expanded="true"');
    expect(unreadHtml).toContain('class="alert-bell-badge"');
    expect(unreadHtml).toContain(">3</span>");
  });

  it("renders clickable alert links, read/unread toggles, and bulk controls", () => {
    const html = renderToStaticMarkup(
      <AlertPopover
        panelId="alerts-panel"
        triggerRef={createRef()}
        alerts={{
          items: sampleAlerts,
          unreadCount: 1,
          onOpenAlert: () => {},
          onMarkRead: () => {},
          onMarkUnread: () => {},
          onMarkAllRead: () => {},
          onDismiss: () => {},
          onClearRead: () => {},
        }}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain(">Mark all read</button>");
    expect(html).toContain(">Clear read</button>");
    expect(html).toContain("Approval needed: Relay");
    expect(html).toContain("Run npm test");
    expect(html).toContain("Scheduled job failed: Nightly");
    expect(html).toContain('data-read="false"');
    expect(html).toContain('data-read="true"');
    expect(html).toContain('aria-label="Mark &quot;Approval needed: Relay&quot; read"');
    expect(html).toContain('aria-label="Mark &quot;Scheduled job failed: Nightly&quot; unread"');
  });

  it("renders empty state when there are no alerts", () => {
    const html = renderToStaticMarkup(
      <AlertPopover
        panelId="alerts-panel"
        triggerRef={createRef()}
        alerts={{
          items: [],
          unreadCount: 0,
          onOpenAlert: () => {},
          onMarkRead: () => {},
          onMarkUnread: () => {},
          onMarkAllRead: () => {},
          onDismiss: () => {},
          onClearRead: () => {},
        }}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("No alerts.");
    expect(html).not.toContain("Mark all read");
    expect(html).not.toContain("Clear read");
  });
});
