import { type PageId, renderedPages, resolvePage } from "./navigation.js";

export type { PageId, SettingsSectionId } from "./navigation.js";

export interface PageTabs {
  open: PageId[];
  active: PageId;
  projectId?: string;
}

export const initialTabs: PageTabs = {
  open: [...renderedPages].sort((a, b) => a.initialOrder - b.initialOrder).map((page) => page.id),
  active: "chat",
};

export type TabAction =
  | { type: "open" | "select" | "close"; id: PageId }
  | { type: "project"; projectId: string };

export function updateTabs(state: PageTabs, action: TabAction): PageTabs {
  if (action.type === "project")
    return { open: state.open, active: "project", projectId: action.projectId };
  action = { ...action, id: resolvePage(action.id) };
  switch (action.type) {
    case "open":
      return {
        open: state.open.includes(action.id) ? state.open : [...state.open, action.id],
        active: action.id,
      };
    case "select":
      return state.open.includes(action.id) ? { open: state.open, active: action.id } : state;
    case "close":
      return state;
  }
}
