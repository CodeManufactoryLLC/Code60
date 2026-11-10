export type PageId =
  | "logs"
  | "contributor-tools"
  | "episodic-memory"
  | "files"
  | "chat"
  | "sessions"
  | "search"
  | "messages"
  | "events"
  | "configurations"
  | "worktrees"
  | "polling"
  | "prompts"
  | "commands"
  | "settings";

export const settingsSectionIds = [
  "agents",
  "appearance",
  "table-defaults",
  "text",
  "polling-settings",
  "updates",
  "about",
] as const;
export type SettingsSectionId = (typeof settingsSectionIds)[number];

export interface PageTabs {
  open: PageId[];
  active: PageId;
}

export const initialTabs: PageTabs = {
  open: [
    "logs",
    "contributor-tools",
    "chat",
    "episodic-memory",
    "sessions",
    "messages",
    "events",
    "search",
    "configurations",
    "worktrees",
    "polling",
    "prompts",
    "commands",
    "settings",
  ],
  active: "chat",
};

export type TabAction = { type: "open" | "select" | "close"; id: PageId };

export function updateTabs(state: PageTabs, action: TabAction): PageTabs {
  if (action.id === "files") action = { ...action, id: "chat" };
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
