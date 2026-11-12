import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi, Snapshot } from "../bridge/index.js";
import type { Theme } from "./appearance.js";
import { Splash } from "./splash.js";

afterEach(() => vi.unstubAllGlobals());

function render(
  changes: Partial<Snapshot> = {},
  ready = true,
  error = "",
  theme: Theme = "light",
  busy = false,
) {
  const snapshot = {
    agents: ["fake"],
    agentSetup: { complete: true },
    orchestration: { provider: "fake" },
    database: "/projects.sqlite",
    projects: [{ path: "/projects/recent", openedAt: "2026-11-11T10:00:00Z" }],
    active: false,
    ...changes,
  } as Snapshot;
  return renderToStaticMarkup(
    <Splash
      api={{} as DesktopApi}
      snapshot={snapshot}
      ready={ready}
      busy={busy}
      error={error}
      theme={theme}
      onThemeChange={() => {}}
      projectActions={{
        onConnect: () => {},
        onOpen: () => {},
        onCreate: () => {},
        onRemove: () => {},
      }}
      onEnter={() => {}}
      onConnectDatabase={() => {}}
    />,
  );
}

describe("startup project sidebar", () => {
  it("replaces Yes/No with the full selector beside the wordmark", () => {
    const html = render();
    expect(html).toContain('class="splash-brand"');
    expect(html).toContain('class="splash-projects"');
    expect(html).toContain("Recent projects");
    expect(html).toContain("/projects/recent");
    expect(html).toContain(">Start</button>");
    expect(html).not.toContain("Clear history");
    expect(html).toContain("<span>Open Folder</span>");
    expect(html).not.toContain("Continue recent?");
    expect(html).not.toContain(">Yes<");
    expect(html).not.toContain(">No<");
  });

  it("does not expose project selection until initial loading finishes", () => {
    expect(render({}, false)).not.toContain('class="splash-projects"');
    expect(render({}, false)).not.toContain("Color theme");
    expect(render({}, false)).not.toContain('aria-label="Splash background"');
  });

  it("keeps Light/Dark controls without a photo or background selector", () => {
    const html = render();
    expect(html).toContain('class="splash" data-theme="light"');
    expect(html).not.toContain("data-background");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('aria-label="Splash background"');
    expect(html).not.toContain("splash-background-dot");
    expect(html).not.toContain("splash-background-picker");
    expect(html).not.toContain("splash-background-status");
    expect(html).toContain('aria-label="Color theme"');
    expect(html).toContain('aria-label="Light mode" aria-pressed="true"');
    expect(html).toContain('aria-label="Dark mode" aria-pressed="false"');
    const dark = render({}, true, "", "dark");
    expect(dark).toContain('data-theme="dark"');
    expect(dark).toContain('aria-label="Light mode" aria-pressed="false"');
    expect(dark).toContain('aria-label="Dark mode" aria-pressed="true"');
  });

  it("keeps System appearance until the user explicitly selects Light or Dark", () => {
    expect(render({}, true, "", "system")).toContain('data-theme="system"');
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    expect(render({}, true, "", "system")).toContain('aria-label="Dark mode" aria-pressed="true"');
  });

  it("groups the exact release subtitle beneath the wordmark and describes the splash with it", () => {
    const html = render();
    const subtitleId = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(subtitleId).toBeDefined();
    expect(html).toContain('class="splash-lockup"');
    expect(html).toContain(
      `<p id="${subtitleId}" class="splash-subtitle">v0.2 &#x27;Paddock&#x27; (Beta)</p>`,
    );
    expect(html.indexOf('class="splash-subtitle"')).toBeGreaterThan(
      html.indexOf('class="wordmark splash-title"'),
    );
  });

  it("ignores all legacy background preferences without reading or writing storage", () => {
    const getItem = vi.fn();
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem, setItem });
    for (const saved of [
      null,
      "watercolor",
      "circuit-blue",
      "finish-line",
      "racing-lights",
      "sunset",
      "neon",
      "https://example.com/image.jpeg",
    ]) {
      getItem.mockReturnValue(saved);
      const html = render();
      expect(html).toContain('data-theme="light"');
      expect(html).not.toContain("data-background");
      expect(html).not.toContain('aria-label="Splash background"');
      expect(html).not.toContain("Background changed");
    }
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("keeps the drag strip separate and paints the theme control above the content", () => {
    const html = render();
    const contentEnd = html.indexOf("</aside>");
    const dragStrip = html.indexOf('class="window-drag-strip" aria-hidden="true"');
    expect(dragStrip).toBeGreaterThan(contentEnd);
    expect(html.indexOf('class="button-group splash-theme-toggle"')).toBeGreaterThan(dragStrip);
  });

  it("keeps the setup gate instead of exposing project controls", () => {
    const html = render({
      agentSetup: { complete: false } as NonNullable<Snapshot["agentSetup"]>,
    });
    expect(html).toContain("Set up agents");
    expect(html).not.toContain("Recent projects");
    expect(html).not.toContain(">Start<");
  });

  it("preserves the database warning and disables project opening without a database", () => {
    const html = render({ database: null });
    expect(html).toContain("Database connection required");
    expect(html).toContain("Connect to database");
    expect(html).not.toContain("/projects/recent");
    expect(html.match(/<button[^>]*class="project-open-folder"[^>]*>/)?.[0]).toContain("disabled");
  });

  it("retains errors and explains active runs without disabling safe welcome controls", () => {
    const html = render({ active: true }, true, "Folder unavailable");
    expect(html).toContain('role="alert">Folder unavailable</div>');
    expect(html).toContain('role="status">Finish or stop all runs before switching projects.');
    expect(html).toContain("Choose Start to return to your workspace.");
    expect(html.match(/<button[^>]*class="project-item"[^>]*>/)?.[0]).not.toContain("disabled");
    expect(html.match(/<button[^>]*class="project-remove"[^>]*>/)?.[0]).not.toContain("disabled");
    expect(html.match(/<button[^>]*class="project-open-folder"[^>]*>/)?.[0]).not.toContain(
      "disabled",
    );
    expect(html.match(/<button[^>]*class="splash-enter"[^>]*>/)?.[0]).not.toContain("disabled");
  });

  it("still disables project actions and Start during an in-flight operation", () => {
    const html = render({ active: true }, true, "", "light", true);
    for (const name of ["project-item", "project-remove", "project-open-folder", "splash-enter"])
      expect(html.match(new RegExp(`<button[^>]*class="${name}"[^>]*>`))?.[0]).toContain(
        "disabled",
      );
  });

  it("does not show an active-run restriction when project switching is available", () => {
    expect(render()).not.toContain("Finish or stop all runs before switching projects.");
    expect(render({ active: true, openProjects: [] })).not.toContain(
      "Finish or stop all runs before switching projects.",
    );
  });
});
