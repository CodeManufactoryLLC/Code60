import { describe, expect, it, vi } from "vitest";
import {
  MCP_ACTIVITY_TOOL_DEFINITIONS,
  MCP_CONTROL_TOOL_DEFINITIONS,
  MCP_TABLE_TOOL_DEFINITIONS,
  MCP_TABLES,
  MCP_TOOL_DEFINITIONS,
} from "../bridge/index.js";
import { readMcpTool } from "./mcp-tables.js";

describe("Code60 table tools", () => {
  it("offers exactly a read and search tool for each UI table", async () => {
    expect(MCP_TABLE_TOOL_DEFINITIONS).toHaveLength(12);
    expect(MCP_TABLE_TOOL_DEFINITIONS.every((tool) => tool.readOnly && !tool.destructive)).toBe(
      true,
    );
    expect(MCP_TOOL_DEFINITIONS).toHaveLength(
      12 + MCP_CONTROL_TOOL_DEFINITIONS.length + MCP_ACTIVITY_TOOL_DEFINITIONS.length,
    );
    expect(new Set(MCP_TOOL_DEFINITIONS.map((tool) => tool.name)).size).toBe(
      MCP_TOOL_DEFINITIONS.length,
    );
    await expect(readMcpTool("code60_list_agents", {}, vi.fn())).rejects.toThrow("Unknown");
    for (const table of MCP_TABLES) {
      for (const action of ["read", "search"]) {
        const reader = vi.fn(async () => [{ id: "1", text: "First row" }]);
        const result = await readMcpTool(
          `code60_${action}_${table}`,
          action === "search" ? { query: "FIRST" } : {},
          reader,
        );
        expect(reader).toHaveBeenCalledWith(table);
        expect(result).toMatchObject({ table, action, total: 1, offset: 0, limit: 50 });
      }
    }
  });

  it("searches full values before clipping and paginates the matches", async () => {
    const reader = async () => [
      { id: "1", text: "unrelated" },
      { id: "2", text: `${"x".repeat(8_100)}needle` },
      { id: "3", text: "NEEDLE" },
    ];
    const clipped = await readMcpTool(
      "code60_search_messages",
      { query: "needle", limit: 1 },
      reader,
    );
    expect(clipped.total).toBe(2);
    expect(clipped.rows[0]?.text).toBe(`${"x".repeat(8_000)}… [truncated]`);
    expect(
      await readMcpTool("code60_search_messages", { query: "needle", offset: 1, limit: 1 }, reader),
    ).toMatchObject({ total: 2, rows: [{ id: "3", text: "NEEDLE" }] });
    expect(await readMcpTool("code60_read_messages", { offset: 50 }, reader)).toMatchObject({
      total: 3,
      rows: [],
    });
  });

  it.each([
    ["code60_delete_sessions", {}],
    ["code60_read_projects", {}],
    ["code60_read_sessions", { query: "anything" }],
    ["code60_read_sessions", { sql: "SELECT * FROM secrets" }],
    ["code60_read_sessions", { path: "/elsewhere" }],
    ["code60_read_sessions", { limit: 101 }],
    ["code60_read_sessions", { limit: 0 }],
    ["code60_read_sessions", { limit: null }],
    ["code60_read_sessions", { offset: -1 }],
    ["code60_read_sessions", { offset: 1.5 }],
    ["code60_read_sessions", { offset: "1" }],
    ["code60_search_sessions", {}],
    ["code60_search_sessions", { query: " " }],
    ["code60_search_sessions", { query: "x".repeat(513) }],
    ["code60_read_sessions", []],
  ])("rejects invalid tool requests without reading tables: %s %j", async (name, args) => {
    const reader = vi.fn(async () => []);
    await expect(readMcpTool(name as string, args, reader)).rejects.toThrow();
    expect(reader).not.toHaveBeenCalled();
  });

  it("reports read failures rather than returning an empty success", async () => {
    await expect(
      readMcpTool("code60_read_messages", {}, async () => {
        throw new Error("Transcript unavailable");
      }),
    ).rejects.toThrow("Transcript unavailable");
  });
});
