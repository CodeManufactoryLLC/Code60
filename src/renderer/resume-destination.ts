import { useEffect, useRef } from "react";
import { isSettingsSection, type PageId, pageDefinitions } from "./navigation.js";
import type { Destination } from "./navigation-history.js";

/** Persist only route identities. Browser storage is untrusted and can be unavailable. */
export function readResume(storage: Storage, key: string): Destination | undefined {
  try {
    const value = JSON.parse(storage.getItem(key) ?? "null");
    if (
      !value ||
      typeof value.page !== "string" ||
      !Object.hasOwn(pageDefinitions, value.page) ||
      value.page === "files"
    )
      return;
    const page = value.page as PageId;
    if (page === "settings")
      return value.section === undefined
        ? { page }
        : isSettingsSection(value.section)
          ? { page, section: value.section }
          : undefined;
    const field =
      page === "chat"
        ? "chat"
        : page === "project"
          ? "project"
          : page === "provider"
            ? "provider"
            : undefined;
    if (!field) return { page };
    return typeof value[field] === "string" && value[field].length > 0
      ? { page, [field]: value[field] }
      : undefined;
  } catch {
    return;
  }
}

export function useResumeDestination(
  key: string | undefined,
  history: {
    current: Destination;
    settled: boolean;
    available(entry: Destination): boolean;
    restore(entry: Destination): Promise<void>;
  },
  relay: string | undefined,
  onError: (message: string) => void,
) {
  const owner = useRef<{ key: string; restoring: boolean; saved?: string } | undefined>(undefined);
  useEffect(() => {
    if (key === undefined) {
      owner.current = undefined;
      return;
    }
    if (!history.settled) return;
    if (owner.current?.key !== key) {
      const entry = { key, restoring: true };
      owner.current = entry;
      const saved = readResume(localStorage, key);
      const target =
        saved && history.available(saved)
          ? saved
          : relay
            ? { page: "chat" as const, chat: relay }
            : undefined;
      if (!target) {
        owner.current = undefined;
        return;
      }
      if (JSON.stringify(target) !== JSON.stringify(history.current)) {
        void history
          .restore(target)
          .catch(() => {
            if (owner.current === entry) onError("Could not reopen the saved destination.");
          })
          .finally(() => {
            entry.restoring = false;
          });
        return;
      }
      entry.restoring = false;
    }
    const current = owner.current;
    if (
      current.restoring ||
      !history.available(history.current) ||
      (history.current.page === "chat" && !history.current.chat)
    )
      return;
    const serialized = JSON.stringify(history.current);
    if (serialized !== current.saved) {
      try {
        localStorage.setItem(key, serialized);
      } catch {
        /* Browsing works without persistence. */
      }
      current.saved = serialized;
    }
  });
}
