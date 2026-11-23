import { findMcpTableTool, type McpTable } from "../bridge/index.js";

export type McpTableRow = Record<string, string | number | boolean | null>;
const TEXT_LIMIT = 8_000;
export type McpTableReader = (table: McpTable) => Promise<readonly McpTableRow[]>;

export interface McpTablePage {
  table: McpTable;
  action: "read" | "search";
  offset: number;
  limit: number;
  total: number;
  query?: string;
  rows: readonly McpTableRow[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function parseArguments(action: "read" | "search", value: unknown) {
  if (!isObject(value)) throw new Error("Tool arguments must be an object");
  const keys = Object.keys(value);
  const allowed = action === "search" ? ["query", "offset", "limit"] : ["offset", "limit"];
  if (keys.some((key) => !allowed.includes(key))) throw new Error("Unknown tool argument");
  const query = value.query;
  if (
    action === "search" &&
    (typeof query !== "string" || query.trim().length === 0 || query.length > 512)
  )
    throw new Error("Search query must contain 1 to 512 characters");
  const offset = value.offset === undefined ? 0 : value.offset;
  const limit = value.limit === undefined ? 50 : value.limit;
  if (!Number.isSafeInteger(offset) || (offset as number) < 0 || (offset as number) > 1_000_000)
    throw new Error("Offset must be an integer from 0 to 1000000");
  if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 100)
    throw new Error("Limit must be an integer from 1 to 100");
  return {
    ...(action === "search" ? { query: query as string } : {}),
    offset: offset as number,
    limit: limit as number,
  };
}

/** Applies a named Code60 table tool to bounded, display-ready rows from the current UI context. */
export async function readMcpTool(
  name: string,
  args: unknown,
  readTable: McpTableReader,
): Promise<McpTablePage> {
  const tool = findMcpTableTool(name);
  if (!tool) throw new Error("Unknown Code60 table tool");
  const parsed = parseArguments(tool.action, args);
  let rows = await readTable(tool.table);
  if (tool.action === "search") {
    const needle = parsed.query?.toLowerCase();
    rows = rows.filter((row) =>
      Object.values(row).some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(needle ?? ""),
      ),
    );
  }
  const page = {
    table: tool.table,
    action: tool.action,
    offset: parsed.offset,
    limit: parsed.limit,
    total: rows.length,
    ...(parsed.query === undefined ? {} : { query: parsed.query }),
    rows: rows
      .slice(parsed.offset, parsed.offset + parsed.limit)
      .map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            typeof value === "string" && value.length > TEXT_LIMIT
              ? `${value.slice(0, TEXT_LIMIT)}… [truncated]`
              : value,
          ]),
        ),
      ),
  };
  return page;
}
