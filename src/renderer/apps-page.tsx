import type { PageId, SettingsSectionId } from "./navigation.js";
import { NavigationHomePage } from "./navigation-home-page.js";
import { staticChildren } from "./navigation-tree.js";

const tasks: Record<string, string> = {
  "mcp-servers": "Configure servers, credentials and connections",
  automations: "Schedule recurring jobs and investigate executions",
  workflows: "Define multi-step work and review runs",
  tables: "Inspect records and diagnostic logs",
  commands: "Create reusable chat commands",
  prompts: "Edit prompts and preview substitutions",
  memory: "Manage memory capture and retention",
  appearance: "Choose a color theme and focus settings",
  "system-manager": "Check service health and recover jobs",
  "polling-settings": "Configure background polling",
  updates: "Check the installed version and update instructions",
};
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
      cards={staticChildren("apps", database).map((node) => ({ ...node, task: tasks[node.id] }))}
      onOpen={({ target }) => {
        if (target.kind === "page" || target.kind === "settings") onOpen(target.id);
      }}
    />
  );
}
