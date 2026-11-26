import { expect, it } from "vitest";
import { mcpWorkspaceFailure } from "./mcp-workspace.js";

it("classifies MCP configuration workspace failures without collapsing unsafe into unavailable", () => {
  expect(mcpWorkspaceFailure(new Error("MCP configuration conflict"))).toContain(
    "MCP_CONFIG_CONFLICT:",
  );
  expect(mcpWorkspaceFailure(new Error("MCP configuration recovery-required"))).toContain(
    "MCP_CONFIG_RECOVERY_REQUIRED:",
  );
  expect(mcpWorkspaceFailure(new Error("MCP configuration invalid"))).toContain(
    "MCP_CONFIG_INVALID:",
  );
  expect(mcpWorkspaceFailure(new Error("MCP configuration storage-limit"))).toContain(
    "MCP_CONFIG_STORAGE_LIMIT:",
  );
  expect(mcpWorkspaceFailure(new Error("MCP configuration unsafe"))).toMatch(
    /^MCP_CONFIG_UNSAFE:.*explicitly reload before saving\./,
  );
  expect(mcpWorkspaceFailure(new Error("MCP configuration unavailable"))).toMatch(
    /^MCP_CONFIG_UNAVAILABLE:.*explicitly reload before saving\./,
  );
  expect(mcpWorkspaceFailure("unexpected")).toContain("MCP_CONFIG_UNAVAILABLE:");
});
