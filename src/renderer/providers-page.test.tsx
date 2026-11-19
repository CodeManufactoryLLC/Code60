import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { DesktopApi, Snapshot } from "../bridge/index.js";
import { breadcrumbAncestors } from "./page-breadcrumbs.js";
import { type ProviderManagement, providerActionReasons } from "./provider-management.js";
import { ProvidersPage } from "./providers-page.js";
import { ProvidersSidebar } from "./providers-sidebar.js";

const snapshot = {
  orchestration: { allowAll: false },
  agentSetup: {
    complete: true,
    primary: "claude",
    enabled: ["claude", "codex"],
    session: null,
    management: { blockedReason: null },
    providers: ["claude", "codex", "droid"].map((id) => ({ id, name: id, logo: id, guidance: "" })),
  },
  modelDefaults: {
    version: 1,
    providers: {
      claude: { worker: [{ configId: "model", name: "Claude model", value: "c" }] },
      codex: { orchestrator: [{ configId: "model", name: "Codex model", value: "x" }] },
    },
  },
} as Snapshot;
const management: ProviderManagement = {
  pending: false,
  error: "",
  addReason: null,
  mode: null,
  act: vi.fn(async () => {}),
  clearDefault: vi.fn(async () => {}),
  add: vi.fn(),
  closeSetup: vi.fn(),
};
const api = { modelDefault: async () => {} } as unknown as DesktopApi;

it("uses saved membership order, a first-position creation card, independent menus and one primary status", () => {
  const html = renderToStaticMarkup(
    <ProvidersPage snapshot={snapshot} api={api} management={management} onOpen={() => {}} />,
  );
  expect(html).toContain('role="switch"');
  expect(html).toContain('aria-checked="false"');
  expect(html.indexOf('aria-label="Add Provider"')).toBeLessThan(
    html.indexOf('aria-label="Open claude"'),
  );
  expect(html.indexOf('aria-label="Open claude"')).toBeLessThan(
    html.indexOf('aria-label="Open codex"'),
  );
  expect(html).not.toContain('aria-label="Open droid"');
  expect(html.match(/aria-label="Primary Provider"/g)).toHaveLength(1);
  expect(html).toContain('data-tooltip="Primary Provider"');
  expect(html).toContain('aria-label="More actions for claude"');
  expect(html).toMatch(/<\/button>.*data-slot="card-action"/);
});

it("keeps Add Provider present and disabled when all providers are added and shares errors", () => {
  const html = renderToStaticMarkup(
    <ProvidersPage
      snapshot={snapshot}
      api={api}
      management={{
        ...management,
        addReason: "All supported providers are connected",
        error: "Save failed. Retry.",
      }}
      onOpen={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Add Provider" disabled=""');
  expect(html).toContain('title="All supported providers are connected"');
  expect(html).toContain('role="alert">Save failed. Retry.');
});

it("scopes saved defaults to the selected provider and uses the Providers breadcrumb", () => {
  const html = renderToStaticMarkup(
    <ProvidersPage
      snapshot={snapshot}
      api={api}
      management={management}
      providerId="codex"
      onOpen={() => {}}
    />,
  );
  expect(html).toContain("Verified provider");
  expect(html).toContain("Codex model");
  expect(html).not.toContain("Claude model");
  expect(html).toContain('aria-label="Clear codex orchestrator model default"');
  expect(html).not.toContain("Permissions");
  expect(
    breadcrumbAncestors("provider", { projects: [], chats: [], runs: [] }).map(
      (crumb) => crumb.label,
    ),
  ).toEqual(["Home", "Providers"]);
});

it("mirrors provider navigation and primary status in a mounted inert sidebar group", () => {
  const html = renderToStaticMarkup(
    <ProvidersSidebar
      setup={snapshot.agentSetup}
      management={management}
      selectedId="codex"
      active
      expanded={false}
      onExpanded={() => {}}
      onHome={() => {}}
      onOpen={() => {}}
      onKeyDown={() => {}}
      onNext={() => {}}
      onFirst={() => {}}
      onLast={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Add Provider"');
  expect(html).toContain('aria-label="Expand Providers"');
  expect(html).toContain('id="provider-codex"');
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('hidden="" inert="" aria-hidden="true"');
  expect(html.match(/aria-label="More actions for /g)).toHaveLength(2);
});

it("derives primary and work restrictions consistently for every management surface", () => {
  const setup = snapshot.agentSetup;
  expect(providerActionReasons(setup, "claude")).toEqual({
    disconnect: "Set another provider as primary first",
    primary: "This is already the primary provider",
  });
  expect(providerActionReasons(setup, "codex")).toEqual({ disconnect: null, primary: null });
  expect(providerActionReasons(setup, "droid").primary).toContain("verify");
  expect(providerActionReasons(setup, "codex", true).disconnect).toContain("Wait");
  expect(providerActionReasons(undefined, "codex").disconnect).toContain("unavailable");
  if (!setup) throw new Error("Missing setup");
  expect(
    providerActionReasons(
      { ...setup, management: { blockedReason: "Finish active work" } },
      "codex",
    ),
  ).toEqual({ disconnect: "Finish active work", primary: "Finish active work" });
});
