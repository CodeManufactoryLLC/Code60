import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VectorSearchPage } from "./vector-search-page.js";

describe("VectorSearchPage", () => {
  it("renders Carbon tabs, toolbar actions, and empty state without decorative tiles", () => {
    const markup = renderToStaticMarkup(
      <VectorSearchPage
        api={{
          codebaseIndexOverview: async () => ({
            generatedAt: "2026-11-27T12:00:00.000Z",
            model: "Jina Embeddings v2 Base Code · INT8 · CPU",
            storeBytes: 0,
            maxRepositories: 24,
            maxChunksPerRepository: 20_000,
            repositories: [],
          }),
          codebaseIndexReindex: async () => ({ started: true }),
          codebaseIndexAdd: async () => ({ added: false }),
          codebaseIndexRemove: async () => ({ removed: false }),
          codebaseIndexSearch: async () => ({
            status: "ready",
            repository: "/repo",
            branch: "main",
            ref: "refs/heads/main",
            commit: "a".repeat(40),
            indexedAt: "2026-11-27T12:00:00.000Z",
            fresh: true,
            fetchStatus: "no_remote",
            model: "Jina Embeddings v2 Base Code · INT8 · CPU",
            totalFiles: 0,
            totalChunks: 0,
            truncated: false,
            hits: [],
          }),
          onCodebaseIndexChanged: () => () => {},
        }}
        active={false}
      />,
    );

    expect(markup).toContain('<span class="page-title-text">Vector Search</span>');
    expect(markup).toContain("Repositories");
    expect(markup).toContain("Query");
    expect(markup).toContain("Refresh");
    expect(markup).toContain("Index repository");
    expect(markup).toContain("No repositories indexed yet.");
    expect(markup).not.toContain("cds--tile");
  });
});
