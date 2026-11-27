import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AlertRecord,
  AlertRequest,
  AlertSnapshot,
  ApplicationClient,
} from "../bridge/index.js";

export interface AlertsState {
  items: readonly AlertRecord[];
  unreadCount: number;
  error: string;
  markRead(id: string): Promise<void>;
  markUnread(id: string): Promise<void>;
  markAllRead(): Promise<void>;
  dismiss(id: string): Promise<void>;
  clearRead(): Promise<void>;
}

/** Format an alert timestamp concisely relative to the current clock. */
export function formatAlertTime(iso: string, nowMs = Date.now()): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "";
  const deltaSeconds = Math.max(0, Math.floor((nowMs - parsed) / 1000));
  if (deltaSeconds < 60) return "Just now";
  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(parsed).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function acceptAlertSnapshot(
  current: AlertSnapshot | null,
  incoming: AlertSnapshot,
): AlertSnapshot {
  if (!current || incoming.revision >= current.revision) return incoming;
  return current;
}

export function useAlerts(api: ApplicationClient, enabled: boolean): AlertsState {
  const [snapshot, setSnapshot] = useState<AlertSnapshot | null>(null);
  const [error, setError] = useState("");
  const latestRevision = useRef(-1);
  const mounted = useRef(true);

  const accept = useCallback((incoming: AlertSnapshot) => {
    if (!mounted.current) return;
    if (incoming.revision < latestRevision.current) return;
    latestRevision.current = incoming.revision;
    setSnapshot((current) => acceptAlertSnapshot(current, incoming));
    setError("");
  }, []);

  useEffect(() => {
    mounted.current = true;
    latestRevision.current = -1;
    if (!enabled || !api.alerts) {
      setSnapshot(null);
      setError("");
      return () => {
        mounted.current = false;
      };
    }
    let active = true;
    // Subscribe before the initial read so updates arriving during load are never missed.
    const unsubscribe =
      api.onAlertsChanged?.((incoming) => {
        if (active) accept(incoming);
      }) ?? (() => {});
    void api
      .alerts({ action: "list" })
      .then((initial) => {
        if (active) accept(initial);
      })
      .catch((cause: unknown) => {
        if (active && mounted.current) {
          setError(cause instanceof Error ? cause.message : "Could not load alerts.");
        }
      });
    return () => {
      active = false;
      mounted.current = false;
      unsubscribe();
    };
  }, [api, enabled, accept]);

  const send = useCallback(
    async (request: AlertRequest) => {
      if (!api.alerts) return;
      try {
        const next = await api.alerts(request);
        accept(next);
      } catch (cause: unknown) {
        if (mounted.current) {
          setError(cause instanceof Error ? cause.message : "Could not update alerts.");
        }
      }
    },
    [api, accept],
  );

  const markRead = useCallback((id: string) => send({ action: "mark-read", id }), [send]);
  const markUnread = useCallback((id: string) => send({ action: "mark-unread", id }), [send]);
  const markAllRead = useCallback(() => send({ action: "mark-all-read" }), [send]);
  const dismiss = useCallback((id: string) => send({ action: "dismiss", id }), [send]);
  const clearRead = useCallback(() => send({ action: "clear-read" }), [send]);

  return {
    items: snapshot?.alerts ?? [],
    unreadCount: snapshot?.unreadCount ?? 0,
    error,
    markRead,
    markUnread,
    markAllRead,
    dismiss,
    clearRead,
  };
}
