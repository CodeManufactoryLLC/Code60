import type { ReviewAddress } from "./review-content.js";
export type FileTab =
  | { id: number; kind: "plan"; planId: string; title: string }
  | { id: number; kind: "blank" | "explorer" }
  | { id: number; kind: "file"; path: string; source?: ReviewAddress }
  | { id: number; kind: "changes" }
  | { id: number; kind: "revision"; reviewId: string; revisionId: string; title: string };

export interface FileTabs {
  workspace: string;
  entries: FileTab[];
  active: number | null;
  nextId: number;
}

export const emptyFileTabs = (workspace: string): FileTabs => ({
  workspace,
  entries: [],
  active: null,
  nextId: 1,
});

export type FileTabAction =
  | { type: "plan"; planId: string; title: string }
  | { type: "reset"; workspace: string }
  | { type: "blank" | "explorer" | "browse" }
  | { type: "file"; path: string; source?: ReviewAddress }
  | { type: "changes" | "ensure-changes" }
  | { type: "revision"; reviewId: string; revisionId: string; title: string }
  | { type: "select" | "close"; id: number }
  | { type: "move"; id: number; to: number };

export function updateFileTabs(state: FileTabs, action: FileTabAction): FileTabs {
  if (action.type === "reset")
    return action.workspace === state.workspace ? state : emptyFileTabs(action.workspace);
  if (action.type === "ensure-changes") {
    if (state.entries.some((tab) => tab.kind === "changes")) return state;
    const tab: FileTab = {
      id: state.nextId,
      kind: "changes",
    };
    return {
      ...state,
      entries: [...state.entries, tab],
      active: state.active ?? tab.id,
      nextId: state.nextId + 1,
    };
  }
  if (action.type === "select")
    return state.entries.some((tab) => tab.id === action.id)
      ? { ...state, active: action.id }
      : state;
  if (action.type === "close") {
    const index = state.entries.findIndex((tab) => tab.id === action.id);
    if (index === -1) return state;
    return {
      ...state,
      entries: state.entries.filter((tab) => tab.id !== action.id),
      active:
        state.active === action.id
          ? (state.entries[index + 1]?.id ?? state.entries[index - 1]?.id ?? null)
          : state.active,
    };
  }
  if (action.type === "move") {
    const index = state.entries.findIndex((tab) => tab.id === action.id);
    if (index === -1) return state;
    const entries = [...state.entries];
    const [tab] = entries.splice(index, 1);
    if (!tab) return state;
    entries.splice(Math.max(0, Math.min(entries.length, action.to)), 0, tab);
    return { ...state, entries };
  }
  if (
    action.type === "plan" ||
    action.type === "file" ||
    action.type === "browse" ||
    action.type === "changes" ||
    action.type === "revision"
  ) {
    const existing = state.entries.find((tab) =>
      action.type === "plan"
        ? tab.kind === "plan" && tab.planId === action.planId
        : action.type === "changes"
          ? tab.kind === "changes"
          : action.type === "revision"
            ? tab.kind === "revision" &&
              tab.reviewId === action.reviewId &&
              tab.revisionId === action.revisionId
            : action.type === "file"
              ? tab.kind === "file" &&
                tab.path === action.path &&
                tab.source?.reviewId === action.source?.reviewId &&
                tab.source?.revisionId === action.source?.revisionId &&
                tab.source?.fileKey === action.source?.fileKey
              : tab.kind === "explorer",
    );
    if (existing)
      return {
        ...state,
        active: existing.id,
        entries: state.entries.map((tab) =>
          tab.id === existing.id && tab.kind === "plan" && action.type === "plan"
            ? { ...tab, title: action.title }
            : tab,
        ),
      };
  }
  const kind = action.type === "browse" ? "explorer" : action.type;
  const active = state.entries.find((tab) => tab.id === state.active);
  if (kind === "explorer" && active?.kind === "blank") {
    return {
      ...state,
      entries: state.entries.map((tab) =>
        tab.id === active.id ? { id: tab.id, kind: "explorer" } : tab,
      ),
    };
  }
  const tab: FileTab =
    action.type === "plan"
      ? { id: state.nextId, kind: "plan", planId: action.planId, title: action.title }
      : action.type === "changes"
        ? {
            id: state.nextId,
            kind: "changes",
          }
        : action.type === "revision"
          ? {
              id: state.nextId,
              kind: "revision",
              reviewId: action.reviewId,
              revisionId: action.revisionId,
              title: action.title,
            }
          : action.type === "file"
            ? {
                id: state.nextId,
                kind: "file",
                path: action.path,
                ...(action.source ? { source: action.source } : {}),
              }
            : { id: state.nextId, kind: kind === "blank" ? "blank" : "explorer" };
  return {
    ...state,
    entries: [...state.entries, tab],
    active: tab.id,
    nextId: state.nextId + 1,
  };
}

export function fileTabLabel(tab: FileTab, entries: FileTab[]): string {
  if (tab.kind === "plan") return `Plan · ${tab.title}`;
  if (tab.kind === "changes") return "Changes";
  if (tab.kind === "revision") return tab.title;
  if (tab.kind !== "file") return tab.kind === "blank" ? "New tab" : "File Explorer";
  if (tab.source) return `${tab.path.split("/").at(-1)} · ${tab.source.label}`;
  const name = tab.path.split("/").at(-1) ?? tab.path;
  return entries.some(
    (other) =>
      other.kind === "file" && other.id !== tab.id && other.path.split("/").at(-1) === name,
  )
    ? tab.path
    : name;
}
