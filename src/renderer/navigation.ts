import type { IconName } from "./icons.js";
import type { NavigationIconName } from "./navigation-icons.js";
import type { Command } from "./overlays.js";

type Group =
  | "chat"
  | "primary"
  | "apps"
  | "tables"
  | "settings"
  | "advanced"
  | "experiments"
  | "legacy";
interface PageDefinition {
  id: string;
  label: string;
  group: Group;
  order: number;
  initialOrder: number;
  database: boolean;
  icon?: NavigationIconName;
  paletteLabel?: string;
  commandIcon?: IconName;
  parent?: ParentPageId;
  internal?: boolean;
}
export const parentPageIds = [
  "projects",
  "apps",
  "tables",
  "settings",
  "advanced",
  "experiments",
] as const;
export type ParentPageId = (typeof parentPageIds)[number];
export const pages = [
  {
    id: "projects",
    label: "Projects",
    group: "chat",
    order: 0,
    initialOrder: 18,
    database: false,
    icon: "app-backlog",
  },
  {
    id: "project",
    label: "Project",
    group: "legacy",
    order: 0,
    initialOrder: 19,
    database: true,
    icon: "app-folder",
    internal: true,
  },
  {
    id: "tables",
    label: "Data Viewer",
    group: "legacy",
    parent: "apps",
    order: 0,
    initialOrder: 20,
    database: false,
    icon: "app-database",
  },
  {
    id: "advanced",
    label: "Advanced",
    group: "legacy",
    parent: "settings",
    order: 0,
    initialOrder: 21,
    database: false,
    icon: "app-analyze",
  },
  {
    id: "experiments",
    label: "Experiments",
    group: "legacy",
    parent: "advanced",
    order: 0,
    initialOrder: 22,
    database: false,
    icon: "app-chemical",
  },
  {
    id: "home",
    initialOrder: -2,
    label: "Home",
    group: "primary",
    order: -1,
    database: false,
    icon: "app-home2",
  },
  {
    id: "automations",
    initialOrder: 16,
    label: "Automation Studio",
    group: "apps",
    order: -1,
    database: false,
    icon: "app-robotic-arm",
  },
  {
    id: "system-manager",
    initialOrder: 17,
    label: "System Manager",
    group: "apps",
    order: 2,
    database: false,
    icon: "wrench",
  },
  {
    id: "apps",
    initialOrder: 14,
    label: "Apps",
    group: "primary",
    order: 1,
    database: false,
    icon: "app-apps",
  },
  {
    id: "chat",
    initialOrder: 2,
    label: "Chat",
    group: "legacy",
    internal: true,
    order: 0,
    database: false,
    icon: "app-backlog",
  },
  {
    id: "episodic-memory",
    initialOrder: 3,
    label: "Episodic Memory",
    group: "experiments",
    order: 0,
    database: true,
    icon: "brain",
  },
  {
    id: "rag",
    initialOrder: -1,
    label: "RAG",
    group: "experiments",
    order: 1,
    database: true,
    icon: "flask",
  },
  {
    id: "contributor-tools",
    initialOrder: 1,
    label: "Contributor Tools",
    group: "advanced",
    order: 1,
    database: false,
    icon: "app-under-construction",
  },
  {
    id: "files",
    initialOrder: -1,
    label: "Files",
    paletteLabel: "File Explorer",
    group: "legacy",
    order: 0,
    database: true,
    icon: "app-folder",
  },
  {
    id: "sessions",
    initialOrder: 4,
    label: "Sessions",
    group: "tables",
    order: 6,
    database: true,
    icon: "app-table",
  },
  {
    id: "configurations",
    initialOrder: 8,
    label: "Configurations",
    group: "tables",
    order: 0,
    database: true,
    icon: "app-table",
  },
  {
    id: "memories",
    initialOrder: 15,
    label: "Memories",
    group: "tables",
    order: 3,
    database: false,
    icon: "app-table",
  },
  {
    id: "messages",
    initialOrder: 5,
    label: "Messages",
    group: "tables",
    order: 4,
    database: true,
    icon: "app-table",
  },
  {
    id: "events",
    initialOrder: 6,
    label: "Events",
    group: "tables",
    order: 1,
    database: true,
    icon: "app-table",
  },
  {
    id: "logs",
    initialOrder: 0,
    label: "Logs",
    group: "tables",
    order: 2,
    database: false,
    icon: "app-table",
  },
  {
    id: "search",
    initialOrder: 7,
    label: "Search",
    group: "primary",
    order: 2,
    database: true,
    icon: "app-search",
  },
  {
    id: "worktrees",
    initialOrder: 9,
    label: "Worktrees",
    group: "tables",
    order: 7,
    database: true,
    icon: "app-table",
  },
  {
    id: "polling",
    initialOrder: 10,
    label: "Polling",
    group: "tables",
    order: 5,
    database: true,
    icon: "app-table",
  },
  {
    id: "prompts",
    initialOrder: 11,
    label: "Prompt Builder",
    group: "apps",
    order: 1,
    database: true,
    icon: "app-ai",
  },
  {
    id: "commands",
    initialOrder: 12,
    label: "Command Builder",
    group: "apps",
    order: 0,
    database: true,
    icon: "app-megaphone",
  },
  {
    id: "settings",
    initialOrder: 13,
    label: "Settings",
    group: "settings",
    order: 0,
    database: false,
    icon: "app-cogwheel",
    commandIcon: "settings",
  },
] as const satisfies readonly PageDefinition[];
export type PageId = (typeof pages)[number]["id"];
export type RenderedPageId = Exclude<PageId, "files">;
export const pageDefinitions = Object.fromEntries(pages.map((page) => [page.id, page])) as Record<
  PageId,
  PageDefinition
>;
export const renderedPages = pages.filter(
  (page) => page.id !== "files",
) as readonly (PageDefinition & { id: RenderedPageId })[];
const settingsSections = [
  { id: "about", label: "About", icon: "app-info" },
  { id: "agents", label: "Agents", icon: "app-helmet" },
  { id: "appearance", label: "Appearance", icon: "app-color-palette" },
  { id: "memory", label: "Memory", icon: "app-bookshelf" },
  { id: "polling-settings", label: "Polling", icon: "app-heart-rate" },
  { id: "table-defaults", label: "Table defaults", icon: "app-table" },
  { id: "text", label: "Text", icon: "app-text-size" },
  { id: "updates", label: "Updates", icon: "app-cloud-computing" },
] as const satisfies readonly { id: string; label: string; icon: NavigationIconName }[];
export type SettingsSectionId = (typeof settingsSections)[number]["id"];
export const settingsSectionIds = settingsSections.map((section) => section.id);
export const settingsLabels = Object.fromEntries(
  settingsSections.map((section) => [section.id, section.label]),
) as Record<SettingsSectionId, string>;
export const settingsIcons = Object.fromEntries(
  settingsSections.map((section) => [section.id, section.icon]),
) as Record<SettingsSectionId, NavigationIconName>;
export const groups = {
  tables: { label: pageDefinitions.tables.label, icon: "app-database" },
  advanced: { label: pageDefinitions.advanced.label, icon: "app-analyze" },
  experiments: { label: pageDefinitions.experiments.label, icon: "app-chemical" },
} as const;
export function isSettingsSection(id: string): id is SettingsSectionId {
  return settingsSectionIds.some((section) => section === id);
}
export function pagesInGroup(group: Group): PageId[] {
  return [...pages]
    .filter((page) => page.group === group)
    .sort((a, b) => a.order - b.order)
    .map((page) => page.id);
}
export function pageGroup(id: PageId | SettingsSectionId) {
  if (isSettingsSection(id)) return "settings";
  if (id === "tables") return "apps";
  if (id === "advanced" || id === "experiments") return "advanced";
  const group = pageDefinitions[id].group;
  return group === "experiments" ? "advanced" : group;
}
export function pageAvailable(id: PageId, database: string | null) {
  return !pageDefinitions[id].database || database !== null;
}
export function resolvePage(id: PageId): RenderedPageId {
  return id === "files" ? "chat" : id;
}
export function pageCommands(
  active: PageId,
  database: string | null,
  navigate: (id: PageId) => void,
  settingsShortcut: string,
): Command[] {
  return pages
    .filter(({ id }) => !pageDefinitions[id].internal)
    .map(({ id }): Command => {
      const page = pageDefinitions[id];
      const disabled = !pageAvailable(id, database);
      return {
        id,
        label: page.paletteLabel ?? page.label,
        group: "Pages",
        icon: page.commandIcon ?? "document",
        checked: active === id,
        disabled,
        ...(disabled ? { reason: "Connect to a database first" } : {}),
        ...(id === "settings" ? { keys: settingsShortcut } : {}),
        run: () => {
          if (!disabled) navigate(id);
        },
      };
    });
}
