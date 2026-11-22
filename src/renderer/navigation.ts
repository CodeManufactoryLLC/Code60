import {
  type Group,
  type ParentPageId,
  pages,
  parentPageIds,
  type PageDefinition as SharedPageDefinition,
  settingsSections,
} from "../bridge/index.js";
import type { IconName } from "./icons.js";
import type { NavigationIconName } from "./navigation-icons.js";
import type { Command } from "./overlays.js";

export { type ParentPageId, pages, parentPageIds };

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
/** Stable section IDs remain adapters; parent metadata owns their visible location. */
export const settingsParents = Object.fromEntries(
  settingsSections.map((section) => [section.id, section.parent]),
) as Record<SettingsSectionId, "apps" | "settings">;
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
  if (isSettingsSection(id)) return settingsParents[id];
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
