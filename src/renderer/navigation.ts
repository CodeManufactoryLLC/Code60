import {
  type Group,
  pages,
  type PageDefinition as SharedPageDefinition,
  settingsSections,
} from "../bridge/index.js";
import type { IconName } from "./icons.js";
import type { NavigationIconName } from "./navigation-icons.js";
import type { Command } from "./overlays.js";

export { pages };

// Shared descriptors store icon names as strings; keep renderer icon names compile-time checked.
type PageDefinition = Omit<SharedPageDefinition, "icon" | "commandIcon"> & {
  icon?: NavigationIconName;
  commandIcon?: IconName;
};
void (pages satisfies readonly PageDefinition[]);
void (settingsSections satisfies readonly { icon: NavigationIconName }[]);
export type PageId = (typeof pages)[number]["id"];
export type RenderedPageId = Exclude<PageId, "files">;
export const pageDefinitions = Object.fromEntries(pages.map((page) => [page.id, page])) as Record<
  PageId,
  PageDefinition
>;
export const renderedPages = pages.filter(
  (page) => page.id !== "files",
) as readonly (PageDefinition & { id: RenderedPageId })[];
export type SettingsSectionId = (typeof settingsSections)[number]["id"];
export const settingsSectionIds = settingsSections.map((section) => section.id);
export const settingsLabels = Object.fromEntries(
  settingsSections.map((section) => [section.id, section.label]),
) as Record<SettingsSectionId, string>;
export const settingsIcons = Object.fromEntries(
  settingsSections.map((section) => [section.id, section.icon]),
) as Record<SettingsSectionId, NavigationIconName>;
export const groups = {
  tables: { label: "Data Viewer", icon: "database" },
  advanced: { label: "Advanced", icon: "wrench" },
  experiments: { label: "Experiments", icon: "flask" },
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
