import type { PageId } from "./navigation.js";
import { NavigationHomePage } from "./navigation-home-page.js";
import { staticChildren } from "./navigation-tree.js";

export function AppsPage({
  database,
  onOpen,
}: {
  database: string | null;
  onOpen(id: PageId): void;
}) {
  return (
    <NavigationHomePage
      page="apps"
      cards={staticChildren("apps", database)}
      onOpen={({ target }) => {
        if (target.kind === "page") onOpen(target.id);
      }}
    />
  );
}
