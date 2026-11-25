import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ApplicationClient, Snapshot } from "../bridge/index.js";
import { type ProviderManagement, providerActionReasons } from "./provider-management.js";
import { ProvidersPage } from "./providers-page.js";

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
const api = { modelDefault: async () => {} } as unknown as ApplicationClient;

it("lists enabled providers in membership order with their menus, defaults and one primary label", () => {
  const html = renderToStaticMarkup(
    <ProvidersPage snapshot={snapshot} api={api} management={management} />,
  );
  const rows = [...html.matchAll(/<li\b[^>]*>(.*?)<\/li>/gs)].map((match) => match[1]);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain("<h2>claude (Primary)</h2>");
  expect(rows[0]).toContain('aria-label="More actions for claude"');
  expect(rows[0]).toContain("Claude model");
  expect(rows[0]).toContain('aria-label="Clear claude worker model default"');
  expect(rows[1]).toContain("<h2>codex</h2>");
  expect(rows[1]).toContain("Codex model");
  expect(rows[1]).toContain('aria-label="Clear codex orchestrator model default"');
  expect(html).not.toContain('aria-label="Open ');
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
    />,
  );
  expect(html).toMatch(/<button[^>]*disabled=""/);
  expect(html).toContain('title="All supported providers are connected"');
  expect(html).toContain('role="alert">Save failed. Retry.');
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
