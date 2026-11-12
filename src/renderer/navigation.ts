import type { IconName } from "./icons.js";
import type { NavigationIconName } from "./navigation-icons.js";
import type { Command } from "./overlays.js";

type Group = "chat" | "primary" | "tables" | "settings" | "advanced" | "experiments" | "legacy";
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
}
export const pages = [
  {
    id: "chat",
    initialOrder: 2,
    label: "Chat",
    group: "chat",
    order: 0,
    database: false,
    icon: "chats",
  },
  {
    id: "episodic-memory",
    initialOrder: 3,
    label: "Episodic Memory",
    group: "experiments",
    order: 0,
    database: true,
  },
  {
    id: "contributor-tools",
    initialOrder: 1,
    label: "Contributor Tools",
    group: "advanced",
    order: 1,
    database: false,
  },
  {
    id: "files",
    initialOrder: -1,
    label: "Files",
    paletteLabel: "File Explorer",
    group: "legacy",
    order: 0,
    database: true,
  },
  { id: "sessions", initialOrder: 4, label: "Sessions", group: "tables", order: 5, database: true },
  {
    id: "configurations",
    initialOrder: 8,
    label: "Configurations",
    group: "tables",
    order: 0,
    database: true,
  },
  { id: "messages", initialOrder: 5, label: "Messages", group: "tables", order: 3, database: true },
  { id: "events", initialOrder: 6, label: "Events", group: "tables", order: 1, database: true },
  { id: "logs", initialOrder: 0, label: "Logs", group: "tables", order: 2, database: false },
  {
    id: "search",
    initialOrder: 7,
    label: "Search",
    group: "primary",
    order: 2,
    database: true,
    icon: "magnifying-glass",
  },
  {
    id: "worktrees",
    initialOrder: 9,
    label: "Worktrees",
    group: "tables",
    order: 6,
    database: true,
  },
  { id: "polling", initialOrder: 10, label: "Polling", group: "tables", order: 4, database: true },
  {
    id: "prompts",
    initialOrder: 11,
    label: "Prompt Editor",
    group: "primary",
    order: 0,
    database: true,
    icon: "pencil-line",
  },
  {
    id: "commands",
    initialOrder: 12,
    label: "Commands",
    group: "primary",
    order: 1,
    database: true,
    icon: "megaphone",
  },
  {
    id: "settings",
    initialOrder: 13,
    label: "Settings",
    group: "settings",
    order: 0,
    database: false,
    icon: "gear",
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
  { id: "agents", label: "Agents" },
  { id: "appearance", label: "Appearance" },
  { id: "table-defaults", label: "Table defaults" },
  { id: "text", label: "Text" },
  { id: "polling-settings", label: "Polling" },
  { id: "updates", label: "Updates" },
  { id: "about", label: "About" },
] as const;
export type SettingsSectionId = (typeof settingsSections)[number]["id"];
export const settingsSectionIds = settingsSections.map((section) => section.id);
export const settingsLabels = Object.fromEntries(
  settingsSections.map((section) => [section.id, section.label]),
) as Record<SettingsSectionId, string>;
export const groups = {
  tables: { label: "Tables", icon: "database" },
  advanced: { label: "Advanced" },
  experiments: { label: "Experiments" },
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
  return pages.map(({ id }): Command => {
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
