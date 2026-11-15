import type { PageId, SettingsSectionId } from "./navigation.js";
import { NavigationHomePage } from "./navigation-home-page.js";
import { staticChildren } from "./navigation-tree.js";

export function SettingsHomePage({
  database,
  onOpen,
}: {
  database: string | null;
  onOpen(id: SettingsSectionId | PageId): void;
}) {
  return (
    <NavigationHomePage
      page="settings"
      id="settings-home"
      cards={staticChildren("settings", database)}
      onOpen={({ target }) => {
        if (target.kind === "page" || target.kind === "settings") onOpen(target.id);
      }}
    />
  );
}
