import { describe, expect, it } from "vitest";
import { parseMcpConnectorDocument } from "./mcp-connectors.js";
import {
  MCP_CONNECTOR_TEMPLATES,
  mcpMoveSchema,
  mcpSaveSchema,
  mcpTargetSchema,
  parseMcpDefinitionText,
  parseMcpManagement,
} from "./mcp-management.js";

const target = { scope: "user", targetId: "a".repeat(64) };
const definition = { label: "Docs", type: "stdio", enabled: true, command: "node" };
const requestId = "11111111-1111-4111-8111-111111111111";
describe("MCP human requests", () => {
  it("accepts only opaque scoped targets with paired project lifetime fences", () => {
    expect(parseMcpManagement(mcpTargetSchema, target)).toEqual(target);
    expect(
      parseMcpManagement(mcpTargetSchema, {
        ...target,
        scope: "project",
        projectId: requestId,
        databaseEpoch: 0,
      }),
    ).toHaveProperty("projectId", requestId);
    for (const value of [
      { ...target, path: "/secret" },
      { ...target, scope: "project" },
      { ...target, databaseEpoch: 1 },
      { ...target, targetId: "../file" },
    ])
      expect(() => parseMcpManagement(mcpTargetSchema, value)).toThrow(
        "Invalid MCP management request.",
      );
  });
  it("validates documents and revision/request identities without leaking inputs", () => {
    const value = {
      target,
      requestId,
      expectedRevision: "b".repeat(64),
      document: { version: 1, servers: { docs: definition } },
    };
    expect(parseMcpManagement(mcpSaveSchema, value).document.servers.docs).toHaveProperty(
      "args",
      [],
    );
    for (const invalid of [
      { ...value, expectedRevision: "stale" },
      { ...value, requestId: "bad" },
      { ...value, document: { SECRET_TOKEN: "do-not-echo" } },
      { ...value, path: "/private" },
    ])
      expect(() => parseMcpManagement(mcpSaveSchema, invalid)).toThrow(
        /^Invalid MCP management request\.$/,
      );
    expect(() =>
      parseMcpManagement(mcpMoveSchema, {
        source: target,
        destination: target,
        serverId: "docs",
        expectedSourceRevision: "b".repeat(64),
        expectedDestinationRevision: "b".repeat(64),
        requestId,
        command: "secret",
      }),
    ).toThrow("Invalid MCP management request.");
  });
  it("imports one reviewed definition disabled, using strict duplicate/size/schema validation", () => {
    expect(parseMcpDefinitionText(JSON.stringify(definition))).toMatchObject({
      enabled: false,
      command: "node",
      args: [],
      env: {},
    });
    for (const text of [
      JSON.stringify({ version: 1, servers: { docs: definition } }),
      '{"label":"secret","labe\\u006c":"secret"}',
      JSON.stringify(definition) + ',"other":' + JSON.stringify(definition),
      JSON.stringify({ ...definition, token: "secret" }),
      " ".repeat(1_048_576),
      "/* secret */" + JSON.stringify(definition),
    ])
      expect(() => parseMcpDefinitionText(text)).toThrow(/^Invalid MCP server definition\.$/);
  });
  it("keeps optional pinned templates schema-valid and disabled", () => {
    for (const template of MCP_CONNECTOR_TEMPLATES) {
      const doc = parseMcpConnectorDocument({
        version: 1,
        servers: { [template.id]: template.definition },
      });
      expect(doc.servers[template.id]?.enabled).toBe(false);
      expect(template.definition.type === "stdio" && template.definition.args[1]).toMatch(/@\d/);
    }
  });
});
