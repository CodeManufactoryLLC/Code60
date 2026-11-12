import { type PageId, renderedPages, resolvePage } from "./navigation.js";

export type { PageId, SettingsSectionId } from "./navigation.js";
export { settingsSectionIds } from "./navigation.js";

export interface PageTabs {
  open: PageId[];
  active: PageId;
}

export const initialTabs: PageTabs = {
  open: [...renderedPages].sort((a, b) => a.initialOrder - b.initialOrder).map((page) => page.id),
  active: "chat",
};

export type TabAction = { type: "open" | "select" | "close"; id: PageId };

export function updateTabs(state: PageTabs, action: TabAction): PageTabs {
  action = { ...action, id: resolvePage(action.id) };
  switch (action.type) {
    case "open":
      return {
        open: state.open.includes(action.id) ? state.open : [...state.open, action.id],
        active: action.id,
      };
    case "select":
      return state.open.includes(action.id) ? { ...state, active: action.id } : state;
    case "close":
      return state;
  }
}
