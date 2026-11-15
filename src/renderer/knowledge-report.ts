import { useEffect, useState } from "react";
import type { DesktopApi, KnowledgeOwner, KnowledgeReport } from "../bridge/index.js";
import type { FileTab, FileTabs } from "./file-tabs.js";
import type { PageId, SettingsSectionId } from "./navigation.js";

type View = KnowledgeReport["view"];
type ReportedTab = Extract<View, { kind: "panel" }>["tabs"][number];
const TAB_LIMIT = 128;

// One renderer generation per document; reloading the document resets both sides.
let renderer: Promise<string | null> | undefined;
let sequence = 0;

/** Presentation-only metadata. Main validates and ignores it for authority. */
function report(api: DesktopApi | undefined, view: View): void {
  if (!api?.reportKnowledge || !api.knowledgeRenderer) return;
  renderer ??= api.knowledgeRenderer().catch(() => null);
  const order = ++sequence;
  void renderer
    .then((id) => {
      if (id) return api.reportKnowledge?.({ renderer: id, sequence: order, view });
      renderer = undefined;
    })
    .catch(() => {
      // A stale owner or renderer generation means the main process already discarded this view.
    });
}

const safeRelative = (path: string) =>
  path.length > 0 &&
  path.length <= 4096 &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  !path.split("/").includes("..") &&
  !/[:\0]/.test(path);

function reportedTab(tab: FileTab): ReportedTab | null {
  if (tab.kind === "file")
    return safeRelative(tab.path)
      ? { id: tab.id, kind: "file", path: tab.path, savedRevision: tab.source !== undefined }
      : null;
  if (tab.kind === "plan") return { id: tab.id, kind: "plan", planId: tab.planId };
  if (tab.kind === "revision")
    return { id: tab.id, kind: "revision", reviewId: tab.reviewId, revisionId: tab.revisionId };
  return { id: tab.id, kind: tab.kind };
}

export function useKnowledgeNavigation(
  api: DesktopApi,
  view: {
    page: PageId;
    settingsSection: SettingsSectionId | null;
    splash: boolean;
    workerId: string | undefined;
    theme: "light" | "dark" | "system";
  },
): void {
  const { page, settingsSection, splash, workerId, theme } = view;
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const changed = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    report(api, {
      kind: "navigation",
      page,
      settingsSection,
      splash,
      visible,
      workerId: workerId && workerId.length <= 256 ? workerId : null,
      theme,
    });
  }, [api, page, settingsSection, splash, visible, workerId, theme]);
}

/** Bounded presentation summary; unsupported file paths are omitted and marked incomplete. */
export function panelReport(tabs: FileTabs) {
  const reported = tabs.entries.slice(0, TAB_LIMIT).flatMap((tab) => reportedTab(tab) ?? []);
  return {
    tabs: reported,
    selected: reported.some((tab) => tab.id === tabs.active) ? tabs.active : null,
    incomplete: reported.length !== tabs.entries.length,
  };
}

export function useKnowledgePanel(
  api: DesktopApi | undefined,
  owner: KnowledgeOwner | undefined,
  panel: { tabs: FileTabs; open: boolean; active: boolean },
): void {
  const [id] = useState(() => crypto.randomUUID());
  const { tabs, open, active } = panel;
  const ownerKey = owner && JSON.stringify(owner);
  // biome-ignore lint/correctness/useExhaustiveDependencies: ownerKey canonically identifies owner.
  useEffect(() => {
    if (!owner) return;
    report(api, { kind: "panel", id, owner, active, open, ...panelReport(tabs) });
  }, [api, id, ownerKey, tabs, open, active]);
  useEffect(() => {
    if (ownerKey) return () => report(api, { kind: "remove", id });
  }, [api, id, ownerKey]);
}
