import type { PageId, SettingsSectionId } from "./navigation.js";
import { NavigationHomePage } from "./navigation-home-page.js";
import { staticChildren } from "./navigation-tree.js";

export function AppsPage({
  database,
  onOpen,
}: {
  database: string | null;
  onOpen(id: PageId | SettingsSectionId): void;
}) {
  return (
    <NavigationHomePage
      page="apps"
      cards={staticChildren("apps", database)}
      onOpen={({ target }) => {
        if (target.kind === "page" || target.kind === "settings") onOpen(target.id);
      }}
    />
  );
}
