import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { OrchestrationChat } from "../bridge/index.js";
import { PageTitle, PageTitleNavigationContext } from "./page-title.js";
import { useBreadcrumbHeader } from "./page-title-header.js";

vi.mock("./page-title-header.js", () => ({ useBreadcrumbHeader: vi.fn() }));
vi.mock("react-dom", async (original) => ({
  ...(await original<typeof import("react-dom")>()),
  createPortal: vi.fn((children: ReactNode) => children),
}));

it("ports the sole interactive heading to the header and leaves an inert, ID-free marker", () => {
  const header = {} as HTMLElement;
  vi.mocked(useBreadcrumbHeader).mockReturnValue(header);
  const html = renderToStaticMarkup(
    <PageTitleNavigationContext.Provider
      value={{
        header: true,
        open: vi.fn(async () => true),
        pending: false,
        projects: [],
        chats: [],
        runs: [],
      }}
    >
      <PageTitle page="orchestrator" id="conversation-title">
        <button type="button">Rename this chat</button>
      </PageTitle>
    </PageTitleNavigationContext.Provider>,
  );
  const placeholder = html.slice(0, html.indexOf("</nav>") + "</nav>".length);
  expect(placeholder).toContain('class="page-breadcrumbs page-title-placeholder"');
  expect(placeholder).toContain('aria-hidden="true" inert=""');
  expect(placeholder).not.toMatch(/<h[12]\b|<button\b|\bid=/);
  expect(html.match(/id="conversation-title"/g)).toHaveLength(1);
  expect(html).not.toContain("Rename this chat");
  expect(placeholder).toContain(">Agent</span>");
  expect(html).not.toContain("page-selector-rename");
  expect(html.match(/aria-label="Page navigation"/g)).toHaveLength(1);
  expect(createPortal).toHaveBeenCalledWith(expect.anything(), header);
});

it("does not size a static page's slot using an unrelated chat without a run", () => {
  vi.mocked(useBreadcrumbHeader).mockReturnValue({} as HTMLElement);
  const html = renderToStaticMarkup(
    <PageTitleNavigationContext.Provider
      value={{
        header: true,
        open: vi.fn(async () => true),
        pending: false,
        projects: [],
        runs: [],
        chats: [{ kind: "project", title: "Unrelated chat", run: null } as OrchestrationChat],
      }}
    >
      <PageTitle page="logs" />
    </PageTitleNavigationContext.Provider>,
  );
  const placeholder = html.slice(0, html.indexOf("</nav>"));
  expect(placeholder).toContain('<span class="page-title-text">Logs</span>');
  expect(placeholder).not.toContain("Unrelated chat");
});
