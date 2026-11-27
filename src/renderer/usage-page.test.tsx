import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UsagePage } from "./usage-page.js";

describe("UsagePage", () => {
  it("renders Carbon usage overview, filters, export controls, tabs, and methodology", () => {
    const markup = renderToStaticMarkup(
      <UsagePage
        api={{
          usageReport: async () => ({
            generatedAt: "2026-11-26T12:00:00.000Z",
            estimatorVersion: 1,
            retentionDays: 90,
            retentionMaxRows: 500_000,
            window: { range: "7d", since: "2026-11-19T12:00:00.000Z", until: null },
            filters: { provider: null, surface: null, model: null },
            status: { totalStoredTurns: 0, dropped: 0, persistenceFailures: 0, unavailable: false },
            totals: {
              turns: 0,
              totalTokens: 0,
              inputTokens: 0,
              newInputTokens: 0,
              cachedOrRereadInputTokens: 0,
              outputTokens: 0,
              netContextDelta: 0,
              toolCalls: 0,
              toolWaves: 0,
              compactions: 0,
              durationMs: 0,
              costs: [],
              exactTurns: 0,
              derivedTurns: 0,
              lowerBoundTurns: 0,
            },
            providers: [],
            surfaces: [],
            hotspots: [],
            timeline: [],
          }),
          usageTurns: async () => ({ turns: [], total: 0, offset: 0, limit: 50, hasMore: false }),
          usageExport: async () => ({
            format: "markdown",
            filename: "usage.md",
            mimeType: "text/markdown",
            content: "# Report",
          }),
          usageClear: async () => ({ cleared: true, deleted: 0 }),
          onUsageChanged: () => () => {},
        }}
        active={false}
      />,
    );

    expect(markup).toContain('<span class="page-title-text">Usage</span>');
    expect(markup).not.toContain("Turns recorded");
    expect(markup).not.toContain("Retained turns");
    expect(markup).not.toContain("Provider-reported cost");
    expect(markup).toContain("Summary");
    expect(markup).toContain("Estimated total tokens");
    expect(markup).toContain("New input");
    expect(markup).toContain("Cached / re-read");
    expect(markup).toContain("Output");
    expect(markup).toContain("Total turns");
    expect(markup).toContain("Net context added");
    expect(markup).toContain("Tool calls");
    expect(markup).toContain("Tool waves");
    expect(markup).toContain("Compactions");
    expect(markup).not.toContain("cds--tile");
    expect(markup).not.toContain("Burn timeline");
    expect(markup).not.toContain("Burn rate by provider and model");
    expect(markup).toContain("Provider burn rate");
    expect(markup).toContain("Usage Timeline");
    expect(markup).toContain("Chats &amp; workflows");
    expect(markup).toContain("Turn inspector");
    expect(markup).toContain("Export");
    expect(markup).toContain("Markdown");
    expect(markup).toContain("JSON");
    expect(markup).toContain("CSV");
    expect(markup).not.toContain("Export Markdown");
    expect(markup).not.toContain("Export JSON");
    expect(markup).not.toContain("Export CSV");
    expect(markup).toContain("How Code60 estimates tokens");
  });
});
