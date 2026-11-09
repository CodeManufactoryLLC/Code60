import type { Block } from "./state.js";

export function McpBadge({ mcp }: Pick<Block, "mcp">) {
  if (mcp === undefined) return null;
  return (
    <span
      className="mcp-attribution"
      role="note"
      aria-label={`MCP server: ${mcp.server ?? "Unknown"}`}
    >
      <span className="mcp-badge">MCP</span>
      <span>{mcp.server ?? "Unknown server"}</span>
    </span>
  );
}
