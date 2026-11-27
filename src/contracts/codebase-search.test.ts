import { describe, expect, it } from "vitest";
import {
  CODEBASE_SEARCH_LIMITS,
  CODEBASE_SEARCH_TOOL_DEFINITIONS,
  codebaseSearchToolsForRole,
  isCodebaseRelativePrefix,
  isCodebaseSearchTool,
  parseCodebaseSearchArgs,
  parseCodebaseStatusArgs,
} from "./codebase-search.js";
import { mcpToolsForRole } from "./mcp-tools.js";

describe("codebase-search contracts", () => {
  it("recognizes codebase search tool names", () => {
    expect(isCodebaseSearchTool("code60_search_codebase")).toBe(true);
    expect(isCodebaseSearchTool("code60_codebase_index_status")).toBe(true);
    expect(isCodebaseSearchTool("code60_browser")).toBe(false);
  });

  it("validates bound search args and rejects cwd or unknown fields", () => {
    expect(parseCodebaseSearchArgs("bound", { query: "embedding model" })).toEqual({
      query: "embedding model",
      limit: CODEBASE_SEARCH_LIMITS.limitDefault,
    });
    expect(
      parseCodebaseSearchArgs("bound", {
        query: "mcp broker",
        limit: 5,
        pathPrefix: "src/gateway",
        language: "typescript",
      }),
    ).toEqual({
      query: "mcp broker",
      limit: 5,
      pathPrefix: "src/gateway",
      language: "typescript",
    });
    expect(() => parseCodebaseSearchArgs("bound", { cwd: "/tmp/repo", query: "mcp" })).toThrow();
    expect(() => parseCodebaseSearchArgs("bound", { query: "   " })).toThrow();
    expect(() =>
      parseCodebaseSearchArgs("bound", {
        query: "test",
        limit: CODEBASE_SEARCH_LIMITS.limitMax + 1,
      }),
    ).toThrow();
  });

  it("validates relay search and status args with required absolute cwd", () => {
    expect(parseCodebaseSearchArgs("relay", { cwd: "/repo", query: "auth" })).toEqual({
      cwd: "/repo",
      query: "auth",
      limit: 10,
    });
    expect(parseCodebaseStatusArgs("relay", { cwd: "/repo" })).toEqual({ cwd: "/repo" });
    expect(parseCodebaseStatusArgs("bound", {})).toEqual({});
    expect(() => parseCodebaseSearchArgs("relay", { query: "auth" })).toThrow();
    expect(() => parseCodebaseSearchArgs("relay", { cwd: "relative", query: "auth" })).toThrow();
    expect(() =>
      parseCodebaseSearchArgs("relay", { cwd: "/repo\nnewline", query: "auth" }),
    ).toThrow();
    expect(() => parseCodebaseStatusArgs("bound", { cwd: "/repo" })).toThrow();
  });

  it("rejects unsafe path prefixes", () => {
    expect(isCodebaseRelativePrefix("src/core")).toBe(true);
    expect(isCodebaseRelativePrefix("src/core/rag.ts")).toBe(true);
    expect(isCodebaseRelativePrefix("")).toBe(false);
    expect(isCodebaseRelativePrefix("/etc/passwd")).toBe(false);
    expect(isCodebaseRelativePrefix("../outside")).toBe(false);
    expect(isCodebaseRelativePrefix("src/../secret")).toBe(false);
    expect(isCodebaseRelativePrefix("src\\win")).toBe(false);
    expect(isCodebaseRelativePrefix("src:stream")).toBe(false);
  });

  it("exposes role-appropriate schemas in codebaseSearchToolsForRole and mcpToolsForRole", () => {
    const bound = codebaseSearchToolsForRole("bound");
    expect(bound).toEqual(CODEBASE_SEARCH_TOOL_DEFINITIONS);
    expect(bound[0]?.inputSchema.required).toEqual(["query"]);
    expect(bound[0]?.inputSchema.properties).not.toHaveProperty("cwd");

    const relay = codebaseSearchToolsForRole("relay");
    expect(relay[0]?.inputSchema.required).toEqual(["cwd", "query"]);
    expect(relay[0]?.inputSchema.properties).toHaveProperty("cwd");
    expect(relay[1]?.inputSchema.required).toEqual(["cwd"]);

    const relayMcp = mcpToolsForRole("relay").find((t) => t.name === "code60_search_codebase");
    expect(relayMcp?.inputSchema.required).toEqual(["cwd", "query"]);
    const projectMcp = mcpToolsForRole("project").find((t) => t.name === "code60_search_codebase");
    expect(projectMcp?.inputSchema.required).toEqual(["query"]);
    expect(projectMcp?.inputSchema.properties).not.toHaveProperty("cwd");
  });
});
