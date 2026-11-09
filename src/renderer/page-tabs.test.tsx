import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "../bridge/index.js";
import { PageTabBar } from "./page-tabs.js";
import { initialTabs } from "./tabs.js";

afterEach(() => vi.unstubAllGlobals());

function navigation(database: string | null, directory?: string) {
  vi.stubGlobal("localStorage", { getItem: () => "true", setItem: () => {} });
  return renderToStaticMarkup(
    <PageTabBar
      tabs={initialTabs}
      directory={directory}
      database={database}
      onSelect={() => {}}
      onOpenProject={() => {}}
      onConnectDatabase={() => {}}
      projectDisabled={false}
      api={{} as DesktopApi}
      chats={[]}
      runs={[]}
      onWorkerSelect={() => {}}
      selectedId={undefined}
      navigationSerial={undefined}
      eventsByRun={{}}
    />,
  );
}

describe("database connection navigation", () => {
  it("replaces project identity with database connection and disables workspace destinations", () => {
    const html = navigation(null, "/old-project");
    const card = html.match(
      /<button[^>]*class="sidebar-header project-card"[\s\S]*?<\/button>/,
    )?.[0];
    expect(card).toContain("Connect to database");
    expect(card).not.toContain("old-project");
    expect(card).not.toContain("disabled");
    for (const id of ["prompts", "search", "sessions", "episodic-memory"]) {
      expect(html.match(new RegExp(`<button[^>]*id="tab-${id}"[^>]*>`))?.[0]).toContain("disabled");
    }
    expect(html.match(/<button[^>]*id="tables-toggle"[^>]*>/)?.[0]).toContain("disabled");
    expect(html.match(/<button[^>]*id="tab-settings"[^>]*>/)?.[0]).not.toContain("disabled");
    expect(html.match(/<button[^>]*id="tab-chat"[^>]*>/)?.[0]).not.toContain("disabled");
  });
  it("restores the project selector and workspace controls with a database", () => {
    for (const directory of [undefined, "/project"]) {
      const html = navigation("/database.sqlite", directory);
      expect(html).toContain(directory ? ">project</span>" : "Open a project");
      expect(html).not.toContain("Connect to database");
      expect(html.match(/<button[^>]*id="tab-prompts"[^>]*>/)?.[0]).not.toContain("disabled");
      expect(html.match(/<button[^>]*id="tables-toggle"[^>]*>/)?.[0]).not.toContain("disabled");
    }
  });
});

describe("page navigation icons", () => {
  it("uses Carbon's Prompt Template UI icon for Prompt Editor", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    const html = renderToStaticMarkup(
      <PageTabBar
        tabs={{ open: ["prompts"], active: "prompts" }}
        onSelect={() => {}}
        onOpenProject={() => {}}
        projectDisabled={false}
        api={{} as DesktopApi}
        chats={[]}
        runs={[]}
        onWorkerSelect={() => {}}
        selectedId={undefined}
        navigationSerial={undefined}
        database={null}
        eventsByRun={{}}
      />,
    );
    const promptTab = html.match(/<button[^>]*id="tab-prompts"[\s\S]*?<\/button>/)?.[0];

    expect(promptTab).toContain('viewBox="0 0 32 32"');
    expect(promptTab).toContain("m31.5,23");
  });
});
